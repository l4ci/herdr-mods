import { test } from "node:test";
import assert from "node:assert/strict";
import { RANK, kidStatus, topLevel, sortAgents, bySpace, summary, navOrder } from "../order.js";

const ag = (address, status, o = {}) => ({ address, status, seq: 0, pinned: false, space: "s1", ...o });
const rank = (a) => RANK[a.status] ?? 0;

test("sort: blocked > done > working > idle, unknown last", () => {
  const l = [ag("i", "idle"), ag("w", "working"), ag("x", "error"), ag("d", "done"), ag("b", "blocked")];
  assert.deepEqual(sortAgents(l, rank, () => 0).map(a => a.address), ["b", "d", "w", "i", "x"]);
});

test("sort: pinned idle agent goes above a blocked one", () => {
  const l = [ag("b", "blocked"), ag("p", "idle", { pinned: true })];
  assert.deepEqual(sortAgents(l, rank, () => 0).map(a => a.address), ["p", "b"]);
});

test("sort: ties by newer since, then higher seq", () => {
  const since = { a: 10, b: 20, c: 20 };
  const l = [ag("a", "working", { seq: 9 }), ag("b", "working", { seq: 1 }), ag("c", "working", { seq: 2 })];
  assert.deepEqual(sortAgents(l, rank, a => since[a.address]).map(a => a.address), ["c", "b", "a"]);
});

test("sort: parent rank uses its blocked sub-agent", () => {
  const urgency = { p: 4, w: 2 };
  const l = [ag("w", "working"), ag("p", "idle")];
  assert.deepEqual(sortAgents(l, a => urgency[a.address], () => 0).map(a => a.address), ["p", "w"]);
});

test("sort: does not mutate its input", () => {
  const l = [ag("i", "idle"), ag("b", "blocked")];
  sortAgents(l, rank, () => 0);
  assert.deepEqual(l.map(a => a.address), ["i", "b"]);
});

test("kidStatus: error is blocked, done is idle, listed wins", () => {
  assert.equal(kidStatus({ address: "k", status: "error" }, new Map()), "blocked");
  assert.equal(kidStatus({ address: "k", status: "done" }, new Map()), "idle");
  assert.equal(kidStatus({ address: "k", status: "idle" }, new Map([["k", "working"]])), "working");
});

test("topLevel: a nested sub-agent is dropped unless pinned", () => {
  const l = [ag("p", "idle"), ag("k", "working"), ag("kp", "idle", { pinned: true })];
  assert.deepEqual(topLevel(l, new Set(["k", "kp"])).map(a => a.address), ["p", "kp"]);
});

test("bySpace: groups by exact id, remote prefix included", () => {
  const m = bySpace([ag("a", "idle", { space: "s1" }), ag("b", "idle", { space: "vps/s3" }), ag("c", "idle", { space: "s1" })]);
  assert.deepEqual(m.get("s1").map(a => a.address), ["a", "c"]);
  assert.deepEqual(m.get("vps/s3").map(a => a.address), ["b"]);
  assert.equal(m.get("s3"), undefined);
});

test("summary: count and most urgent status", () => {
  assert.deepEqual(summary([ag("a", "idle"), ag("b", "done")], rank), { count: 2, status: "done" });
  assert.deepEqual(summary([ag("x", "error")], rank), { count: 1, status: null });
  assert.equal(summary([], rank), null);
});

test("navOrder: groups in sidebar order", () => {
  assert.deepEqual(navOrder([[ag("a", "idle")], [], [ag("b", "idle"), ag("c", "idle")]]), ["a", "b", "c"]);
});
