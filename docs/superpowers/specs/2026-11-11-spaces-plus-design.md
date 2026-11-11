# spaces-plus: one sidebar for devices, spaces and agents

Status: design, waiting for approval. Date: 2026-11-11.

## Intent

The Herdr sidebar now has two lists: `spaces` (top) and `agents` (bottom). To find an agent that needs you, you must look in the agents list and then find its space in the spaces list. The new mod merges the two into one tree:

```
device            (fold)
  space           (fold)
    agent         sorted: pinned, then blocked > done > working > idle
      sub-agent   (fold under its parent, as now)
```

The person sees each agent in its place, and the most urgent agents are at the top of each space.

## Goals

- One mod, `spaces-plus`, replaces the `spaces` and `agents` blocks in the person's layout.
- Devices fold, as now. Spaces also fold.
- Spaces keep the order the person drags them into. Spaces do not move because of agent status.
- In a space, the agent order is:
  1. pinned agents, at the top of their own space (there is no global "Pinned" section),
  2. then by status: blocked > done > working > idle.
  Inside one status bucket (and inside the pinned group), keep the agents mod's tiebreak: most recent status change first (`since`), then `seq`.
- A space with no agents shows a "no agents" row. A click on that row opens a new tab with a terminal in that space.
- `setAgentOrder` gets the agents in the order they are shown (device → space → sorted agents, top to bottom), so `agent.next` / `agent.prev` follow the sidebar.

## Non-goals

- No change to Herdr's shipped `spaces` or `agents` mods. They stay as they are, so other layouts (`main`, `win98`, …) still work.
- No global priority view and no sort menu. The agents mod's "priority / grouped" choice goes away in this mod.
- No new agent statuses and no new data sources.

## Anti-goals (it fails even if it "works")

- Losing a feature of the current spaces list: drag to reorder, worktree spaces nested under their repo, branch / ahead-behind / changes info, right-click space menu, device reconnect and login guidance, "New space there", `+` new space.
- Losing a feature of the current agents list: sub-agent tree and fold, peek for sub-agents without a pane, hover pin / unpin, "Needs you" pill, spinner, done dot, idle ring, focused-row highlight.
- A timer to animate anything. Use `.spin()` / `.frames()` / `.loop()` only.
- Spaces that jump around when agent status changes.

## What it looks like

The reference mockup is `sidebar-v6.html`, saved in this folder as `2026-11-11-spaces-plus-mockup.html`. Colors there are placeholders. The mod uses `theme()`.

Header: the "Spaces" header of the spaces mod (31px, label "Spaces", `+` for `space.new`). There is no agents header.

Rows, on a 4px grid:

| Row | Height | Content |
|---|---|---|
| Device | 28px | `workspace-chrome/monitor.svg` (this computer) or `server.svg` (others), 13px; name; fold chevron. Same as the spaces mod now. |
| Space | 30px | colored letter tile (18px, `space.colors`) or branch icon for worktrees; name; git tail; fold chevron at the right end. Same as the spaces mod now, plus the chevron. |
| Agent | 30px | program icon 16px, name, status mark. Same as the agents mod row now (`px 8`, `gap 9`, `rounded 8`). Left indent 10px more than the space row, so the icon is under the space tile. |
| Sub-agent | 26px | same as the agents mod's sub-agent row now, 16px more indent than its parent. |
| No agents | 30px | "no agents" in `t.dim`, italic, at agent indent. On hover: "+ terminal" at the right. |

Spacing: 12px between spaces, 20px between devices. 2px after a device header.

Status marks (copy from the agents mod `status()`): working = `spinner.svg` with `.spin(900)`; blocked = "Needs you" pill; done = filled dot; idle = ring.

Pin: no mark at rest. On hover, the agents mod's pin button (`pin.svg` / `pin-off.svg`, tooltip "Pin to the top" / "Unpin", `terminal.pin`) shows, as now. Copy that code. "Pin to the top" now means the top of its space.

Folded space or folded device: at the right, the count of agents under it and a dot in the color of the most urgent status (the agents mod's folded group header does this now). No agents: no count.

## How it behaves

- Click a space name: `space.select` (as now). Click its chevron: fold or unfold. Drag a space: reorder within its device (as now). Right-click: the space menu (as now).
- Click a device header: fold or unfold (as now).
- Click an agent: `pane.focus` its pane (as now). Click a sub-agent: focus it if it has a pane, else peek (as now).
- Click "no agents": `tab.new` with `space: <id>` and `folder:` the space's current place (its first terminal's live folder, else `space.folder`; the spaces mod's `place()`), then the new tab is selected. Builder's call (made in chat by Claude, not the person): the folder is passed explicitly, because the default is the focused terminal's folder, which can be in another space.
- Fold state is kept in `localStorage`: devices as the spaces mod does now (`machines.folded`), spaces under a new key (`spaces.folded`). Sub-agent folds as the agents mod does now.
- A folded space hides its agent rows. The count and dot replace them.

### Narrow rail

The rail rule stays: the sidebar is a rail when its `px` width is < 160 (see `narrow()` in the agents mod). In the rail, show only the space tiles (as the spaces mod's `compact()` does now), each with a small dot in the color of its most urgent agent (none when no agents or all idle). No agent rows in the rail. The `»` button to widen the sidebar again (now in the agents mod) moves to the bottom of this mod. The person said "sounds good for now": the rail can change later.

## Built from

- Start with `mod.clone` of `spaces` (keeps the drag, worktree, git and device code), named `spaces-plus`. Then copy in the agent row, sub-agent tree, pin, peek and status code from `agents`.
- Both shipped mods are in `~/.config/herdr-app/mods/{spaces,agents}/main.js` (Herdr 0.1.15). Read `~/.config/herdr-app/AGENTS.md` and `herdr.d.ts` first.
- Agent → space: `agents()[i].space` (id). Sub-agents: `terminals()` `parent`, as in the agents mod's `tree()`.
- The mod imports `mods/workspace-chrome/*.svg` icons as the shipped mods do. It does not copy them.
- `NOTICE`: the code is adapted from Herdr's shipped mods. Check the license text in the Herdr app before publishing and write the NOTICE to match.

## Where it lives

- Repo: `~/Dev/herdr-mods` (public, `github.com/l4ci/herdr-mods`), as a third folder: `spaces-plus/mods/spaces-plus/`, `spaces-plus/RECIPE.md`, `spaces-plus/preview.png`, plus a section in `README.md`.
- `install.sh` links `spaces-plus` too.
- Layout: in the person's `main-plus.json` (dotfiles: `~/dotfiles/herdr-app/.config/herdr-app/layouts/main-plus.json`), replace the `sidebar-lists` column (`spaces` + `agents` blocks) with one block `{ "id": "sidebar-list", "type": "block", "content": { "mod": "spaces-plus" }, "size": { "weight": 1 }, "min": 90 }`. Check how `~/.config/herdr-app/layouts/main-plus.json` relates to the dotfiles copy (it is not a symlink) before editing.

## Done when

- `herdr-app check ~/.config/herdr-app/mods/spaces-plus` passes, and `herdr-app status` shows no errors.
- `herdr-app shot` shows the tree: device → space → agents, with the sizes above.
- With a blocked, a done, a working and an idle agent in one space, they show in that order. A pinned idle agent shows above all of them.
- Pin and unpin from hover work, and the pinned agent moves to the top of its space only.
- `agent.next` walks the agents in the sidebar's top-to-bottom order.
- Folding a space hides its agents and shows the count and most-urgent dot. The fold survives a mod reload.
- A click on "no agents" opens a terminal tab in that space's folder.
- Dragging a space still reorders it. Worktree spaces still nest. A remote device still folds and shows reconnect / login rows.
- The narrow rail shows the space tiles with status dots and the `»` button works.
- Node tests for the pure sort / group function (no Herdr imports), run like the other mods' tests.

## Calls made after the builder check

These are Claude's calls, not the person's. Each keeps the current agents mod behavior where one exists.

1. **Parent rank:** a parent agent sorts by its most urgent status, its own or a sub-agent's, as the agents mod does now ("parents take their most urgent sub-agent's place"). Its own row still shows its own status mark. The fold dot and the rail dot use the same urgency.
2. **done → idle and `since`:** port `track()` as it is. When the person looks at a done agent, it becomes idle and moves to the idle bucket. That is correct: it no longer needs attention.
3. **Persisted state:** port `track()` (`changed`) and `migratePins` (`pins`) under the same keys in the new mod's own `localStorage`. The old values are not migrated: `since` stamps start fresh once. Pins are not lost, because they live on the terminal (`herdr.pinned` label), not in `localStorage`. Merge the timers: one 30 s data timer, plus the spaces mod's git and reconnect work.
4. **Which agents:** every agent goes under the space with the id `agents()[i].space`. Agents always belong to a Herdr space (Herdr shows only terminals with its labels), so there is no "Other" group. An agent whose space is not in `spaces()` is not shown. A repo space's fold count and dot include the agents of its nested worktree spaces.
5. **Rail toggle:** no new control. The shipped mods enter the rail only by width (`narrow()`), and they widen it again with `»` at the bottom of the rail. Keep the same. `cmd-b` (`layout.toggle:sidebar`) still hides the whole sidebar.
6. **`setAgentOrder`:** pass the same set as the agents mod now: top-level and pinned agents, not nested sub-agents. Folded agents stay in the order. Use the sidebar's order: device → space (drag order) → sorted agents. `agent.next` into a folded space focuses the pane and does not unfold the space.
7. **"no agents" on a device that is not ready:** when the device's layout is `loading` or `unavailable`, the row shows "no agents" without the "+ terminal" action, and a click does nothing.

## Left to the builder

- Module split (`main.js` plus a pure `order.js` for the sort, so Node can test it).
- Exact colors and the dot size in the rail.
- How to merge the two mods' `init()` state and timers without double polling.
