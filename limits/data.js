// Pure helpers for the Limits mod: the shell script that gathers the sources, the
// parsers for its output, and the window maths. No Herdr imports, so tests load this
// with plain Node. Window design adapted from ozcberkay/herdr-coban (claude-status),
// Apache-2.0.

// One shell call reads everything (LC_ALL=C: some locales use decimal commas).
// Claude: the status line's per-account usage cache, /tmp/claude/statusline-usage-<hash>.json,
// <hash> = first 8 hex of sha256 of the config dir path. Accounts = ~/.claude-* with a
// settings.json and a projects dir (.claude-mem has the former only).
// Codex: the last rate_limits line of the most recently written rollout (tail, never the
// whole file). Lines with both windows null (limit_id "premium") carry no limits and are
// skipped, else they hide the "codex" line before them. Rollouts live under the day their session started, so a long session keeps
// writing into an older day dir: sort the recent days' files together by mtime.
export const SCRIPT = String.raw`export LC_ALL=C
for d in "$HOME"/.claude-*; do
  [ -f "$d/settings.json" ] && [ -d "$d/projects" ] || continue
  h=$(printf %s "$d" | shasum -a 256 | cut -c1-8)
  f=/tmp/claude/statusline-usage-$h.json
  echo "@@claude $(basename "$d")"
  if [ -f "$f" ]; then echo "@@mtime $(stat -f %m "$f")"; cat "$f"; echo; fi
done
days=$(ls -d "$HOME"/.codex/sessions/*/*/* 2>/dev/null | sort -r | head -3)
files=$(for day in $days; do for f in "$day"/rollout-*.jsonl; do [ -f "$f" ] && echo "$f"; done; done)
[ -n "$files" ] && for f in $(ls -t $files | head -10); do
  l=$(tail -c 4000000 "$f" | grep '"rate_limits":{' | grep -v '"primary":null,"secondary":null' | tail -n 1)
  if [ -n "$l" ]; then echo "@@codex"; echo "@@mtime $(stat -f %m "$f")"; echo "$l"; break; fi
done
exit 0
`;

export const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad = (n) => String(n).padStart(2, "0");
export const clock = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

// A duration for people: 7m, 2h 05m, 3d 4h.
export function span(seconds) {
  const m = Math.max(0, Math.round(seconds / 60));
  if (m < 60) return `${m}m`;
  if (m < 24 * 60) return `${Math.floor(m / 60)}h ${pad(m % 60)}m`;
  return `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`;
}

// ISO timestamp -> epoch seconds. Microseconds are cut to milliseconds first.
export function isoSeconds(s) {
  if (typeof s !== "string") return null;
  const ms = Date.parse(s.replace(/(\.\d{3})\d+/, "$1"));
  return Number.isFinite(ms) ? ms / 1000 : null;
}

// Window length label from minutes: 300 -> 5h, 10080 -> 7d, else Nm / Nh.
export function windowLabel(minutes) {
  if (typeof minutes !== "number" || minutes <= 0) return "?";
  if (minutes % 1440 === 0 && minutes >= 1440 * 2) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

const CLAUDE_WINDOWS = [
  { key: "five_hour", label: "5h", name: "5-hour limit", seconds: 5 * 3600 },
  { key: "seven_day", label: "7d", name: "Weekly limit", seconds: 7 * 86400 },
];

// One Claude cache file -> windows [{label, name, seconds, used, at}] (at: epoch s or null).
export function parseClaude(json) {
  let j;
  try { j = typeof json === "string" ? JSON.parse(json) : json; } catch { return []; }
  const out = [];
  for (const w of CLAUDE_WINDOWS) {
    const l = j?.[w.key];
    if (typeof l?.utilization !== "number") continue;
    // resets_at: ISO from the OAuth endpoint, epoch seconds from the statusline's stdin.
    const at = typeof l.resets_at === "number" ? l.resets_at : isoSeconds(l.resets_at);
    out.push({ label: w.label, name: w.name, seconds: w.seconds, used: l.utilization, at });
  }
  return out;
}

// One Codex rollout line -> { at: line timestamp (epoch s) | null, windows }.
export function parseCodex(line) {
  let j;
  try { j = JSON.parse(line); } catch { return null; }
  const rl = j?.payload?.rate_limits ?? j?.rate_limits;
  if (!rl) return null;
  const windows = [];
  for (const key of ["primary", "secondary"]) {
    const w = rl[key];
    if (typeof w?.used_percent !== "number") continue; // null window: skipped
    const label = windowLabel(w.window_minutes);
    windows.push({
      label,
      name: `${label} limit`,
      seconds: typeof w.window_minutes === "number" ? w.window_minutes * 60 : null,
      used: w.used_percent,
      at: typeof w.resets_at === "number" ? w.resets_at : null,
    });
  }
  return { at: isoSeconds(j.timestamp), windows };
}

// The script's output -> { claude: [{name, label, at, windows}], codex: {at, windows} | null }.
// `at` = when the source last reported (epoch s).
export function parseOutput(text) {
  const claude = [];
  let codex = null;
  let cur = null;
  for (const line of (text ?? "").split("\n")) {
    if (line.startsWith("@@claude ")) {
      const dir = line.slice(9).trim();
      cur = { kind: "claude", name: dir, label: `Claude ${dir.replace(/^\.claude-/, "").charAt(0).toUpperCase()}`, at: null, windows: [] };
      claude.push(cur);
    } else if (line === "@@codex") {
      cur = { kind: "codex", at: null, windows: [], line: null };
    } else if (line.startsWith("@@mtime ") && cur) {
      cur.mtime = Number(line.slice(8));
    } else if (line.startsWith("{") && cur) {
      if (cur.kind === "claude") {
        cur.windows = parseClaude(line);
        cur.at = cur.mtime ?? null;
      } else {
        const c = parseCodex(line);
        if (c) codex = { at: c.at ?? cur.mtime ?? null, windows: c.windows };
      }
    }
  }
  return { claude: claude.map(({ name, label, at, windows }) => ({ name, label, at, windows })), codex };
}

// One window at `now` (epoch s). `passed`: part of the window behind us (null if the
// length or reset is unknown); `pace`: percent at the reset if use continues at the same
// rate (null in the first 5% of a window). A reset in the past: reset true, used 0.
export function windowState(w, now) {
  if (w.at === null || w.at === undefined) return { ...w, reset: false, noReset: true, left: null, passed: null, pace: null };
  const left = w.at - now;
  if (left <= 0) return { ...w, reset: true, used: 0, left: 0, passed: null, pace: null };
  const passed = w.seconds ? Math.min(1, Math.max(0, 1 - left / w.seconds)) : null;
  const pace = passed !== null && passed >= 0.05 ? w.used / passed : null;
  return { ...w, reset: false, left, passed, pace };
}

// Theme color name for a window.
export function tone(s) {
  if (s.reset) return "dim";
  if (s.used >= 90 || (s.pace ?? 0) >= 100) return "ansi1";
  if (s.used >= 70 || (s.pace ?? 0) >= 85) return "ansi3";
  return "accent";
}

export function resetText(s) {
  if (s.reset) return "reset";
  if (s.left === null) return "—";
  if (s.left > 86400) {
    const d = new Date(s.at * 1000);
    return `${DAYS[d.getDay()]} ${clock(d)}`;
  }
  return span(s.left);
}

export const STALE = 3600; // s: older than this the age turns ansi3
export function ageText(at, now) {
  if (at === null || at === undefined) return null;
  const d = now - at;
  return d < 60 ? "now" : `${span(d)} ago`;
}
export const isStale = (at, now) => at !== null && at !== undefined && now - at > STALE;
