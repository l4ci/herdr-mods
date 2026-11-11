# spaces-plus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One Herdr sidebar mod, `spaces-plus`, that shows devices → spaces → agents (sorted pinned, blocked, done, working, idle) and replaces the `spaces` + `agents` blocks in the person's `main-plus` layout.

**Architecture:** Clone Herdr's shipped `spaces` mod (keeps drag, worktrees, git, devices), then port the agent rows, sub-agent tree, pins and status marks from the shipped `agents` mod. All sorting, grouping and fold summaries live in a pure `order.js` (no Herdr imports) so Node tests cover them. `main.js` only draws.

**Tech Stack:** Herdr app 0.1.15 mods (JavaScript on gpui-kit, `herdr` module), Node `node:test` for the pure module.

**Spec:** `docs/superpowers/specs/2026-11-11-spaces-plus-design.md` (read it first; the mockup is `docs/superpowers/specs/2026-11-11-spaces-plus-mockup.html`). Also read `~/.config/herdr-app/AGENTS.md` sections "Mods" and "The `herdr` module", and `herdr.d.ts`.

**Source mods to port from (read-only, never edit):** `~/.config/herdr-app/mods/spaces/main.js`, `~/.config/herdr-app/mods/agents/main.js`.

## Global Constraints

- Repo: `~/Dev/herdr-mods`, branch `spaces-plus`. Mod files: `spaces-plus/mods/spaces-plus/`. Linked into `~/.config/herdr-app/mods/spaces-plus` by `install.sh`.
- Herdr does not reload through a symlink: after every edit run `./install.sh` (it replaces the link, which reloads the mod).
- Every UI task ends with `herdr-app check ~/.config/herdr-app/mods/spaces-plus` exit 0 and `herdr-app status` with no errors for `spaces-plus`.
- Colors only from `theme()`. No animation timers: `.spin(900)` for the spinner, nothing else animates.
- Rows: device 28px, space 30px, agent 30px (`px 8`, `gap 9`, `rounded 8`, icon 16px), sub-agent 26px, "no agents" 30px. Agent rows indent 10px more than space rows. Sub-agent rows keep the agents mod look (tree lines, `pl(39)`), shifted 10px right like their parent (`pl(49)`). This replaces the spec's "16px more", which did not match the current agents list.
- Spacing: 12px between spaces, 20px between devices, 2px after a device header.
- Sort inside a space: pinned first; then rank `blocked 4 > done 3 > working 2 > idle 1` (unknown 0, last); ties: newer `since` first, then higher `seq` first. A parent's rank is the max of its own and its live sub-agents' ranks (`kidStatus`).
- Spaces keep drag order; status never moves a space.
- Icons: reuse `mods/workspace-chrome/*.svg` (`monitor`, `server`, `chevron-down`, `chevron-right`, `spinner`, `pin`, `pin-off`, `plus`). Don't copy them.
- Commits: imperative subject ≤72 chars, body says why, stage explicit paths, no Co-Authored-By trailer.

## Review Focus

1. **Remote ids:** a remote space's id and its agents' `space` carry a `<machine>/` prefix. Grouping must match ids exactly as given. Test: `bySpace` with `"vps/s3"` (Task 1).
2. **Status Herdr doesn't list** (`error`, `undefined`): it must not crash and must sort last. A sub-agent's `error` counts as blocked (`kidStatus`). Test in Task 1.
3. **Space not shown yet:** the spaces mod hides a space for up to 1.5 s until git answers (`this.shown`). Its agents must stay hidden with it, and must not appear under another space. Check in Task 3 with `herdr-app shot` right after `space.new`.
4. **Long names:** agent and space names truncate; status marks and pin button never get pushed out at 268px. Check in Task 3 with a tab renamed to 60 characters.
5. **Pinned agent that is also a nested sub-agent:** the agents mod shows it as its own row (`a.pinned || !nested`). Keep that. Test: `topLevel` (Task 1).

---

### Task 1: Pure ordering module

**Files:**
- Create: `spaces-plus/mods/spaces-plus/order.js`
- Test: `spaces-plus/mods/spaces-plus/tests/order.test.mjs`

**Interfaces:**
- Produces (all named exports of `order.js`):
  - `RANK: { blocked: 4, done: 3, working: 2, idle: 1 }`
  - `kidStatus(k, listed: Map<address, status>): string` — copied from agents mod: `listed` status else `k.status`; `"error"` → `"blocked"`, `"done"` → `"idle"`.
  - `topLevel(list, nested: Set<address>): agent[]` — keeps `a.pinned || !nested.has(a.address)`.
  - `sortAgents(list, rankOf: a => number, sinceOf: a => number): agent[]` — new array, pinned first, each group sorted by rank desc, since desc, seq desc.
  - `bySpace(list): Map<spaceId, agent[]>` — keyed by `a.space`, input order kept.
  - `summary(list, rankOf): { count: number, status: "blocked"|"done"|"working"|"idle"|null } | null` — `null` for an empty list; `status` is the name of the highest rank (null when it is 0).
  - `navOrder(groups: agent[][]): string[]` — flattened addresses, groups in the given order.

- [ ] **Step 1: Write the failing tests**

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test spaces-plus/mods/spaces-plus/tests/order.test.mjs`
Expected: FAIL, cannot find module `../order.js`.

- [ ] **Step 3: Implement `order.js` with the exports in Interfaces.** No imports.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test spaces-plus/mods/spaces-plus/tests/order.test.mjs`
Expected: all 10 tests pass.

- [ ] **Step 5: Commit**

```bash
git add spaces-plus/mods/spaces-plus/order.js spaces-plus/mods/spaces-plus/tests/order.test.mjs
git commit -m "Add pure agent ordering for spaces-plus" -m "Sorting and grouping are the rules the person cares about, so they live where Node tests can pin them without the app."
```

### Task 2: Clone `spaces` into the repo and link it

**Files:**
- Create: `spaces-plus/mods/spaces-plus/main.js`, `mod.json` (from `mod.clone`), `spaces-plus/mods/spaces-plus/NOTICE`
- Modify: `install.sh` (the `for m in vitals limits` list)

**Interfaces:**
- Produces: a working `spaces-plus` mod identical in behavior to `spaces`, linked at `~/.config/herdr-app/mods/spaces-plus`.

- [ ] **Step 1: Clone.** Run `herdr-app do mod.clone '{"name":"spaces","as":"spaces-plus"}'`. Expected: `~/.config/herdr-app/mods/spaces-plus/` exists, a real folder.
- [ ] **Step 2: Move it into the repo.** `mv ~/.config/herdr-app/mods/spaces-plus/main.js ~/.config/herdr-app/mods/spaces-plus/mod.json spaces-plus/mods/spaces-plus/` (keep `order.js` and `tests/` from Task 1), then `rm -r ~/.config/herdr-app/mods/spaces-plus` (only after you confirm it holds nothing else you need; `.d.ts`/`jsconfig.json` are rewritten by Herdr).
- [ ] **Step 3: Edit `mod.json`:** `"title": "Spaces+"`, keep `"place": "none"` and `cloned_from`.
- [ ] **Step 4: Write `NOTICE`:** "Adapted from the `spaces` and `agents` mods shipped with the Herdr app (https://herdr.dev), licensed under the Apache License, Version 2.0." Same format as `vitals/mods/vitals/NOTICE`.
- [ ] **Step 5: Add `spaces-plus` to the loop in `install.sh`; run `./install.sh`.** Expected output includes `linked spaces-plus`.
- [ ] **Step 6: Check.** `herdr-app check ~/.config/herdr-app/mods/spaces-plus` → exit 0.
- [ ] **Step 7: Commit** `spaces-plus/mods/spaces-plus/{main.js,mod.json,NOTICE}` and `install.sh`: "Clone Herdr's spaces mod as spaces-plus" (body: start from the shipped mod so drag, worktrees and devices keep working).

### Task 3: Agents under each space

**Files:**
- Modify: `spaces-plus/mods/spaces-plus/main.js`

**Interfaces:**
- Consumes: Task 1 exports (`import { RANK, kidStatus, topLevel, sortAgents, bySpace, summary, navOrder } from "./order.js"`).
- Produces (methods on the view, used by Tasks 4 and 5): `agentRows(spaceId, t): Element[]` (agent rows, their sub-agent rows, or the "no agents" row), `status(t, a, compact)`, `this.urgency: Map<address, number>` and `this.groups: Map<spaceId, agent[]>` (sorted top-level agents), both rebuilt at the start of `render()`.

- [ ] **Step 1: Port from `agents/main.js` without changes in behavior:** `icon()`, `kidStatus` use, `track()`, `migratePins()`, `since()`, `peek()`, `tree()`, `subRow()`, `status()`, the hover pin button (`pin.svg`/`pin-off.svg`, tooltip "Pin to the top"/"Unpin", `terminal.pin`), the row's name logic (`title`, `leadPanes`, `clean`, `label`). Add to `init()`: `this.changed`, `this.pendingPins`, `this.migratingPins`, `this.agentFolds = new Set()` (sub-agent folds), `this.hovered`. Merge the agents mod's `cx.timer.every(30000, cx => cx.notify())` into the existing init (one 30 s timer). Drop `SORTS`, `sortOf`, `sortMenu`, the priority/grouped branches and the `props().sortMenu` path.
- [ ] **Step 2: In `render()`, before drawing:** `list = agents()`; `track`; `migratePins(terminals())`; `nested` as in the agents mod; `top = topLevel(list, nested)`; `this.urgency` as the agents mod's `urgency` map; `this.groups = new Map([...bySpace(top)].map(([s, l]) => [s, sortAgents(l, a => this.urgency.get(a.address), a => this.since(a))]))`.
- [ ] **Step 3: In `grouped()`, after each space row (not in the rail), append `agentRows(r.w.id, t)`.** Agent row = the agents mod row with `pl(18)` instead of `px(8)` on the left (right stays 8), 30px, `gap 9`, `rounded 8`, `t.selected` when focused, click `pane.focus {pane}`. Sub-agent rows: `subRow` with its left padding raised by 10px, folded by `this.agentFolds`. Only spaces in `ordered()` (shown) get rows.
- [ ] **Step 4: "no agents" row** when the group is empty: 30px, `pl(18)`, italic `t.dim` "no agents"; on hover a right-aligned `plus.svg` (12px) + "terminal" in `t.foreground`. When the space's device layout is `ready` (`machines()` entry with `layout === "ready"`, or `machine == null`): click → `run("tab.new", { space: w.id, folder: place(w, panes()) })`. Otherwise no hover action and no click.
- [ ] **Step 5: Spacing.** 12px top margin on every space block except the first of a device; 20px between device blocks; 2px after a device header. Remove the `Agents` header logic (none was cloned) and keep the `Spaces` header.
- [ ] **Step 6: Keyboard order.** At the end of `render()`: `setAgentOrder(navOrder(shownSpaceIdsInOrder.map(id => this.groups.get(id) ?? [])))` — include spaces that are folded (Task 4) but not spaces hidden by `ordered()`.
- [ ] **Step 7: Check.** `./install.sh && herdr-app check ~/.config/herdr-app/mods/spaces-plus` → exit 0. To see it before Task 6, open it as a pane: `herdr-app do pane.split '{"direction":"right","mod":"spaces-plus"}'`, then `herdr-app shot /tmp/sp-3.png` and compare with the mockup: agents under their space, sorted, status marks, hover pin. Then do Review Focus 3 and 4. Run `herdr-app do agent.next` a few times and confirm with `herdr-app status` that focus walks the sidebar order top to bottom. Close the pane.
- [ ] **Step 8: Commit** `main.js`: "Show each space's agents under it, sorted by urgency" (body: the person finds what needs them in place, without a second list).

### Task 4: Fold spaces, summaries on folded spaces and devices

**Files:**
- Modify: `spaces-plus/mods/spaces-plus/main.js`

**Interfaces:**
- Consumes: `summary`, `this.groups`, `this.urgency`, `status()` from Task 3.

- [ ] **Step 1: Space fold state.** `this.spaceFolds = new Set(JSON.parse(localStorage.getItem("spaces.folded") ?? "[]"))`; toggle saves the array back under `spaces.folded`.
- [ ] **Step 2: Chevron on the space row,** at the right end after the git tail: `chevron-down`/`chevron-right` 11px, `t.dim`, its own `.id`, click toggles and calls `cx.stop_propagation()` so it does not select or start a drag. A folded space draws no agent rows.
- [ ] **Step 3: Summary on folded space:** agents = the space's group plus the groups of its nested worktree spaces (rows with `tree` that follow it in `ordered()`), `summary(list, a => this.urgency.get(a.address))`. When non-null: count in `t.dim` 11px and a 7px dot `bg(t[status])` (no dot when status null), left of the chevron. Hide nested worktree spaces while their repo space is folded.
- [ ] **Step 4: Summary on folded device:** same, over all agents of that device's shown spaces, in the device header left of its chevron.
- [ ] **Step 5: Check.** `./install.sh`, `herdr-app check …` exit 0; fold a space and a device in the pane copy; `herdr-app shot /tmp/sp-4.png` shows count + dot; save any file in the mod (reload) and confirm folds stay.
- [ ] **Step 6: Commit:** "Fold spaces and show what waits inside" (body: a folded space must still say when an agent needs you).

### Task 5: Narrow rail

**Files:**
- Modify: `spaces-plus/mods/spaces-plus/main.js`

- [ ] **Step 1: In `compact()`,** add a 6px dot at the tile's top-right (`absolute`), `bg(t[s.status])`, where `s = summary(group + nested worktree groups)`. No dot when `s` is null, `s.status` is null or `"idle"`.
- [ ] **Step 2: Port `toggleSidebar()` from the agents mod** and its rail-only `»` row at the bottom (28px, `t.dim`, hover `t.foreground`).
- [ ] **Step 3: Check.** `herdr-app check …` exit 0. With the layout from Task 6 (or now, via `herdr-app do layout.resize '{"id":"sidebar","px":76}'`), `herdr-app shot` shows tiles with dots; click `»` restores the width.
- [ ] **Step 4: Commit:** "Show agent urgency on space tiles in the rail".

### Task 6: Put it in the person's layout

**Files:**
- Modify: `~/.config/herdr-app/layouts/main-plus.json` (live), then copy to `~/dotfiles/herdr-app/.config/herdr-app/layouts/main-plus.json` (they are identical today; they are copies, not links).

- [ ] **Step 1:** Replace the `sidebar-lists` column (its `spaces` and `agents` blocks) with `{ "id": "sidebar-list", "type": "block", "content": { "mod": "spaces-plus" }, "size": { "weight": 1 }, "min": 90 }`.
- [ ] **Step 2:** Check: no `~/.config/herdr-app/layout.error`; `herdr-app status` clean; `herdr-app shot /tmp/sp-6.png` shows one tree in the sidebar.
- [ ] **Step 3:** `cp` the file to the dotfiles path; in `~/dotfiles` (its own repo, check the branch first) commit only that path: "Use spaces-plus as the Herdr sidebar".

### Task 7: Docs for the public repo

**Files:**
- Create: `spaces-plus/RECIPE.md`, `spaces-plus/preview.png`
- Modify: `README.md` (intro "Two mods" → "Three mods", a `## spaces-plus` section, the install snippet, the test command)

- [ ] **Step 1: `preview.png`:** `herdr-app shot`, crop the sidebar (`sips -c <h> 268*scale --cropOffset 0 0`), width shown at 284 in README like the others.
- [ ] **Step 2: `RECIPE.md`** in the AGENTS.md order: name + paragraph + image; What you see; How it behaves (all four statuses, pin, folds, "no agents", rail); Built from; Watch out (symlink reload, `this.shown` delay, remote id prefix); Done when (the spec's list).
- [ ] **Step 3: README:** the layout snippet replacing `sidebar-lists`; test command `node --test vitals/mods/vitals/tests/vitals.test.mjs limits/mods/limits/tests/limits.test.mjs spaces-plus/mods/spaces-plus/tests/order.test.mjs` → all pass.
- [ ] **Step 4: Commit** the three paths: "Document spaces-plus". Do not push: the person decides when the public repo gets it.
