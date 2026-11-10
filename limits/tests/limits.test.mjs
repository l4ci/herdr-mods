import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, chmodSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCRIPT, parseOutput, parseClaude, parseCodex, windowLabel, windowState, tone, resetText, span, ageText, isStale, isoSeconds } from "../data.js";

const fx = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8");
const H = 3600;

test("shell output: two Claude accounts and Codex from real files", () => {
  const d = parseOutput(fx("shell-output.txt"));
  assert.deepEqual(d.claude.map((a) => a.label), ["Claude P", "Claude W"]);
  const w = d.claude[1];
  assert.equal(w.at, 1793717401);
  assert.deepEqual(w.windows.map((x) => [x.label, x.used]), [["5h", 0], ["7d", 3]]);
  assert.equal(w.windows[0].at, Date.parse("2026-11-03T19:50:00.683Z") / 1000);
  assert.equal(d.codex.windows.length, 1);
  assert.equal(d.codex.at, Date.parse("2026-11-03T01:51:06.639Z") / 1000); // line timestamp, not mtime
});

test("claude: null resets_at keeps the window, no reset time", () => {
  const p = parseOutput(fx("shell-output.txt")).claude[0];
  assert.equal(p.windows[0].used, 0);
  assert.equal(p.windows[0].at, null);
  const s = windowState(p.windows[0], 1e9);
  assert.equal(s.pace, null);
  assert.equal(s.passed, null);
  assert.equal(resetText(s), "—");
  assert.equal(tone(s), "accent");
});

test("claude: garbage and missing utilization yield no windows", () => {
  assert.deepEqual(parseClaude("not json"), []);
  assert.deepEqual(parseClaude({ five_hour: { utilization: null } }), []);
});

test("claude: epoch-seconds resets_at (statusline stdin cache) is kept", () => {
  const w = parseClaude({ five_hour: { utilization: 12, resets_at: 1794400000 } });
  assert.equal(w[0].at, 1794400000);
});

test("script: codex skips premium lines with no windows, uses the newest real one", async () => {
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync, mkdirSync, writeFileSync, utimesSync } = await import("node:fs");
  const { SCRIPT } = await import("../data.js");
  const home = mkdtempSync("/tmp/limits-test-");
  const day = `${home}/.codex/sessions/2026/11/07`;
  mkdirSync(day, { recursive: true });
  const real = '{"timestamp":"2026-11-07T00:00:00.000Z","payload":{"rate_limits":{"limit_id":"codex","primary":{"used_percent":42,"window_minutes":10080,"resets_at":5},"secondary":null}}}';
  const premium = '{"timestamp":"2026-11-07T01:00:00.000Z","payload":{"rate_limits":{"limit_id":"premium","primary":null,"secondary":null}}}';
  writeFileSync(`${day}/rollout-a.jsonl`, real + "\n" + premium + "\n");
  writeFileSync(`${day}/rollout-b.jsonl`, premium + "\n");
  utimesSync(`${day}/rollout-a.jsonl`, 1000, 1000); // b is newer and has only a premium line
  const out = execFileSync("sh", ["-c", SCRIPT], { env: { ...process.env, HOME: home } }).toString();
  const d = parseOutput(out);
  assert.deepEqual(d.codex.windows.map((x) => [x.label, x.used]), [["7d", 42]]);
});

test("codex window labels", () => {
  assert.equal(windowLabel(300), "5h");
  assert.equal(windowLabel(10080), "7d");
  assert.equal(windowLabel(45), "45m");
  assert.equal(windowLabel(120), "2h");
  assert.equal(windowLabel(undefined), "?");
});

test("codex: null secondary is skipped, both windows kept when present", () => {
  const line = fx("shell-output.txt").split("\n").find((l) => l.includes('"rate_limits"'));
  const one = parseCodex(line);
  assert.deepEqual(one.windows.map((w) => [w.label, w.used, w.at, w.seconds]), [["7d", 90, 1794256294, 604800]]);
  const two = parseCodex(JSON.stringify({ timestamp: "2026-11-03T01:51:06.639Z", payload: { rate_limits: {
    primary: { used_percent: 10, window_minutes: 300, resets_at: 1 }, secondary: { used_percent: 20, window_minutes: 10080, resets_at: 2 } } } }));
  assert.deepEqual(two.windows.map((w) => w.label), ["5h", "7d"]);
  assert.equal(parseCodex(JSON.stringify({ payload: { rate_limits: { primary: null, secondary: null } } })).windows.length, 0);
  assert.equal(parseCodex("{broken"), null);
});

test("codex: no timestamp falls back to the file mtime", () => {
  const out = '@@codex\n@@mtime 1234\n{"payload":{"rate_limits":{"primary":{"used_percent":5,"window_minutes":300,"resets_at":99}}}}\n';
  assert.equal(parseOutput(out).codex.at, 1234);
});

test("missing source: no codex, no accounts", () => {
  assert.deepEqual(parseOutput(""), { claude: [], codex: null });
  const d = parseOutput("@@claude .claude-x\n");
  assert.equal(d.claude[0].label, "Claude X");
  assert.deepEqual(d.claude[0].windows, []);
  assert.equal(d.claude[0].at, null);
});

test("span and reset text", () => {
  assert.equal(span(7 * 60), "7m");
  assert.equal(span(2 * H + 5 * 60), "2h 05m");
  assert.equal(span(3 * 86400 + 4 * H), "3d 4h");
  const now = 1_000_000;
  assert.equal(resetText(windowState({ used: 10, at: now + 4 * H + 23 * 60, seconds: 5 * H }, now)), "4h 23m");
  const at = now + 2 * 86400;
  const d = new Date(at * 1000);
  const want = `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()]} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  assert.equal(resetText(windowState({ used: 10, at, seconds: 7 * 86400 }, now)), want);
});

test("passed reset: reads reset, used 0, dim", () => {
  const s = windowState({ used: 95, at: 500, seconds: 5 * H }, 1000);
  assert.equal(s.reset, true);
  assert.equal(s.used, 0);
  assert.equal(resetText(s), "reset");
  assert.equal(tone(s), "dim");
});

test("pace and tone thresholds", () => {
  const now = 1_000_000, len = 100 * H;
  const at = (passed) => now + len * (1 - passed);
  const st = (used, passed) => windowState({ used, at: at(passed), seconds: len }, now);
  assert.equal(st(10, 0.04).pace, null); // first 5%: no pace
  assert.equal(tone(st(60, 0.04)), "accent");
  assert.ok(Math.abs(st(30, 0.5).pace - 60) < 1e-9);
  assert.equal(tone(st(30, 0.5)), "accent");
  assert.equal(tone(st(40, 0.5)), "accent"); // pace 80: below 85
  assert.equal(tone(st(43, 0.5)), "ansi3"); // pace 86 >= 85
  assert.equal(tone(st(70, 0.99)), "ansi3"); // used >= 70
  assert.equal(tone(st(50, 0.5)), "ansi1"); // pace 100
  assert.equal(tone(st(90, 0.99)), "ansi1"); // used >= 90
});

test("age text and staleness", () => {
  assert.equal(ageText(1000, 1030), "now");
  assert.equal(ageText(1000, 1000 + 12 * 60), "12m ago");
  assert.equal(ageText(1000, 1000 + 3 * 86400), "3d 0h ago");
  assert.equal(ageText(null, 5), null);
  assert.equal(isStale(0, 3601), true);
  assert.equal(isStale(0, 3600), false);
});

test("isoSeconds handles microseconds and bad input", () => {
  assert.equal(isoSeconds("2026-11-03T14:50:00.669678+00:00"), Date.parse("2026-11-03T14:50:00.669Z") / 1000);
  assert.equal(isoSeconds(null), null);
  assert.equal(isoSeconds("nope"), null);
});

// The script against a fake $HOME, with stub `security` and `curl` first in PATH.
// Stub curl records the config it gets on stdin and prints the canned body.
function sandbox({ blob = null, body = '{"five_hour":{"utilization":12,"resets_at":null},"seven_day":{"utilization":34,"resets_at":null}}', headers = "" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "limits-"));
  const home = join(root, "home"), bin = join(root, "bin"), cache = join(root, "cache");
  for (const d of [".claude-x/projects", ".claude-mem", ".claude/projects"]) mkdirSync(join(home, d), { recursive: true });
  for (const d of [".claude-x", ".claude-mem", ".claude"]) writeFileSync(join(home, d, "settings.json"), "{}");
  mkdirSync(bin);
  const stub = (name, text) => { writeFileSync(join(bin, name), `#!/bin/sh\n${text}\n`); chmodSync(join(bin, name), 0o755); };
  // Only the hashed service (.claude-x) has a login; the default dir has none.
  stub("security", blob === null ? "exit 44" : `case "$*" in *credentials-*) cat "${root}/blob" ;; *) exit 44 ;; esac`);
  if (blob !== null) writeFileSync(join(root, "blob"), blob);
  writeFileSync(join(root, "body"), body);
  writeFileSync(join(root, "headers"), headers);
  stub("curl", `cat > "${root}/curl-stdin"; echo "$*" > "${root}/curl-args"
while [ $# -gt 0 ]; do [ "$1" = -D ] && cp "${root}/headers" "$2"; shift; done
cat "${root}/body"`);
  const run = () => execFileSync("sh", ["-c", SCRIPT], { encoding: "utf8", env: { HOME: home, PATH: `${bin}:/usr/bin:/bin`, HERDR_LIMITS_CACHE: cache } });
  return { root, home, cache, run };
}
const FUTURE = (Date.now() + 3600_000);
const login = (expiresAt = FUTURE) => JSON.stringify({
  claudeAiOauth: { accessToken: "sk-ant-oat01-GOOD", refreshToken: "sk-ant-ort01-R", expiresAt, scopes: ["user:inference"] },
  mcpOAuth: { "some-server": { accessToken: "mcp-token-MUST-NOT-LEAK", expiresAt: 1 } },
});
const cacheFile = (sb) => { // the one cache file of .claude-x
  const out = execFileSync("sh", ["-c", `ls "${sb.cache}" 2>/dev/null | grep 'statusline-usage-.*json$' || true`], { encoding: "utf8" }).trim();
  return out ? join(sb.cache, out) : null;
};

test("script: no cache -> fetches with the Claude token only, and never prints it", () => {
  const sb = sandbox({ blob: login() });
  const out = sb.run();
  const d = parseOutput(out);
  assert.deepEqual(d.claude.map((a) => [a.name, a.label]), [[".claude-x", "Claude X"]]); // .claude-mem: no projects; .claude: no login
  assert.deepEqual(d.claude[0].windows.map((w) => [w.label, w.used]), [["5h", 12], ["7d", 34]]);
  assert.equal(readFileSync(join(sb.root, "curl-stdin"), "utf8"), 'header = "Authorization: Bearer sk-ant-oat01-GOOD"\n');
  const args = readFileSync(join(sb.root, "curl-args"), "utf8");
  assert.ok(!args.includes("sk-ant") && !out.includes("sk-ant") && !out.includes("mcp-token"));
  assert.match(cacheFile(sb), /statusline-usage-[0-9a-f]{8}\.json$/);
});

test("script: a fresh cache is used as it is, no fetch", () => {
  const sb = sandbox({ blob: login() });
  sb.run();
  execFileSync("rm", [join(sb.root, "curl-stdin")]);
  assert.equal(parseOutput(sb.run()).claude[0].windows[1].used, 34);
  assert.ok(!existsSync(join(sb.root, "curl-stdin")));
});

test("script: an old cache is fetched again", () => {
  const sb = sandbox({ blob: login() });
  sb.run();
  const old = new Date(Date.now() - 301_000);
  utimesSync(cacheFile(sb), old, old);
  writeFileSync(join(sb.root, "body"), '{"five_hour":{"utilization":50,"resets_at":null}}');
  assert.equal(parseOutput(sb.run()).claude[0].windows[0].used, 50);
});

test("script: expired or missing login -> no request, the account shows without data", () => {
  for (const blob of [login(Date.now() - 1000), null, '{"mcpOAuth":{"s":{"accessToken":"mcp-token"}}}']) {
    const sb = sandbox({ blob });
    const d = parseOutput(sb.run());
    assert.deepEqual(d.claude.map((a) => [a.name, a.windows.length]), [[".claude-x", 0]]);
    assert.ok(!existsSync(join(sb.root, "curl-stdin")));
  }
});

test("script: a failed fetch backs off for Retry-After seconds", () => {
  const sb = sandbox({ blob: login(), body: '{"error":"rate_limited"}', headers: "HTTP/2 429\r\nRetry-After: 120\r\n" });
  assert.equal(parseOutput(sb.run()).claude[0].windows.length, 0);
  const backoff = execFileSync("sh", ["-c", `cat "${sb.cache}"/*.backoff`], { encoding: "utf8" }).trim();
  assert.equal(backoff, "120");
  execFileSync("rm", [join(sb.root, "curl-stdin")]);
  sb.run();
  assert.ok(!existsSync(join(sb.root, "curl-stdin"))); // inside the window: no second request
});

test("script: ~/.claude gets a card when it has a cache file, labelled Claude", () => {
  const sb = sandbox();
  mkdirSync(sb.cache);
  writeFileSync(join(sb.cache, "statusline-usage.json"), '{"seven_day":{"utilization":7,"resets_at":null}}\n');
  const d = parseOutput(sb.run());
  assert.deepEqual(d.claude.map((a) => [a.name, a.label, a.windows.length]), [[".claude", "Claude", 1], [".claude-x", "Claude X", 0]]);
});
