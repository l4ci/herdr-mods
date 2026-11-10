import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseOutput, parseClaude, parseCodex, windowLabel, windowState, tone, resetText, span, ageText, isStale, isoSeconds } from "../data.js";

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
