# Limits bar

The Limits mod as one line in Herdr's bottom status bar: each Claude account and Codex with the percent used per window, white while fine, then orange and red. The details are in a tooltip. It reads the same data as Limits, so both can be shown at once.

![Limits bar](preview.png)

## What you see

A block on the right of the status bar, 28px high, `chrome` background, a 1px `border` line at the top (the same as `workspace-status` next to it), 11.8px text, items aligned right with 6px between them.

Each item, 22px high, `px 6`, `rounded 5`, `hover` background on hover:

- The program icon, 12px (`icons/claude.svg` or `icons/codex.svg`).
- The name ("Claude P", "Codex") in `muted`; in `ansi3` when the numbers are older than an hour.
- Per window ("5h", "7d"): the label in `dim` and the percent: `foreground` (white) while fine, `ansi3` (orange) from 70% used or a pace of 85% by the reset, `ansi1` (red) from 90% used or a pace past 100%, `dim` right after a reset.
- "no data" or "cannot read" in `dim` when there are no windows.

## How it behaves

- Reads every 30 seconds, as Limits does; redraws when the data changes or the minute turns.
- Hover an item: a tooltip with each window's percent, reset time ("resets Fri 21:00 (in 2d 3h)"), the pace at the reset, and how old the numbers are.
- Click an item: the usage page opens (claude.ai or chatgpt.com).

## Built from

- Layout: the status block becomes a row: `{ "id": "status", "type": "row", "size": { "px": 28 }, "children": [ { "id": "status-main", "type": "block", "content": { "mod": "workspace-status" }, "size": { "weight": 1 } }, { "id": "limits-bar", "type": "block", "content": { "mod": "limits-bar" }, "size": { "px": 420 } } ] }`.
- `mods/limits-bar/data.js` is the same file as `limits/mods/limits/data.js` (the shell script, the parsers and the window maths; its tests are in `limits/`). `main.js` is the Limits view redrawn as a row.
- Runs `sh -c SCRIPT` (see the Limits section of the README for what it reads and when it reaches the network) and `open <url>`.

## Watch out

- The block has a fixed width. 420px fits three sources with one window each; more accounts or 5h windows need more. Too narrow, the first items are cut off on the left.
- With Limits also shown, both mods run the script every 30 seconds. The script's 5-minute cache and backoff keep the network requests the same.
- Keep `data.js` in step with the Limits copy.

## Done when

- `herdr-app check ~/.config/herdr-app/mods/limits-bar` passes.
- The status bar shows one item per Claude account and Codex with percents that match the Limits panel.
- The tooltip shows reset times; a click opens the usage page.
