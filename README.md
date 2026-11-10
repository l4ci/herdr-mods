# herdr-mods

Two mods for the [Herdr](https://herdr.dev) desktop app. They sit together in one side panel tab in my layout.

## vitals

One card per machine: this computer first, then every machine connected in Herdr.

Each card shows CPU, memory, swap, disk and network. CPU, memory and network also have a small graph of the last 40 samples. On a Mac the headline shows the battery, and a click on the local card opens Activity Monitor. Hover the CPU row to see the three busiest processes.

It samples every 3 seconds while the Herdr window is in front and the tab is visible, and every 30 seconds otherwise. Each sample is one shell call per machine. macOS and Linux are supported.

"Visible" is read from the layout: the mod looks for a block with the id `panel` that is not hidden and a `panel-body` whose active tab is `vitals`. With other ids it still works, at the 30 second rate.

Network counts physical interfaces only (`en*` on macOS; on Linux everything except loopback, Docker, bridges and VPN tunnels), so VPN traffic is not counted twice.

## limits

Subscription usage for Claude accounts and Codex, as bars with a pace mark and the reset time. A click opens the usage page.

Claude accounts are the config folders `~/.claude` and `~/.claude-*` that have a `settings.json` and a `projects` folder. The card label is "Claude" plus the first letter after the dash. `~/.claude` only gets a card when it has a login.

No status line is needed. Every 5 minutes at most, the mod asks the usage endpoint that Claude Code itself uses (`api.anthropic.com/api/oauth/usage`). For that it reads the account's OAuth token: from the Keychain item `Claude Code-credentials` on macOS, or from `.credentials.json` in the config folder elsewhere. Read `SCRIPT` in `limits/data.js` before you install this; it is about 50 lines of shell. Things to know:

- The token goes to curl on stdin and to Anthropic only. It is never printed or written to disk.
- The endpoint is not documented and may change. After a failed request the mod waits (the server's `Retry-After`, else 5 minutes) before it tries again.
- The mod does not refresh tokens. When a token has expired, the numbers stay old until Claude Code runs again for that account.
- macOS may ask once whether `security` may read the Keychain item.

The result is cached in `/tmp/claude/statusline-usage[-<hash>].json`, where `<hash>` is the first 8 hex characters of the SHA-256 of the config folder path. If your status line already writes that file (with `five_hour` and `seven_day` objects that hold `utilization` and `resets_at`), the mod uses it and makes no request while the file is younger than 5 minutes.

Codex limits are read from the newest rollout file under `~/.codex/sessions`. No request is made for Codex.

## Install

```sh
git clone https://github.com/l4ci/herdr-mods.git
cd herdr-mods
./install.sh
```

The script links both folders into `~/.config/herdr-app/mods`. Both mods have `"place": "none"`, so they show up only where a layout names them:

```json
{ "id": "vitals", "type": "column", "children": [
  { "id": "vitals-machines", "type": "block", "size": { "weight": 1 }, "content": { "mod": "vitals" } },
  { "id": "limits", "type": "block", "size": { "px": 260 }, "content": { "mod": "limits" } }
] }
```

## Editing

Herdr hot-reloads a mod when its files change, but not through a symlink. After an edit, run `./install.sh` again. Replacing the link makes Herdr reload the mod.

`herdr-app check <folder>` loads a mod once and reports errors. `herdr-app status` shows errors from the running app.

## Tests

The parsers have no Herdr imports, so plain Node runs them:

```sh
node --test vitals/tests/vitals.test.mjs limits/tests/limits.test.mjs
```

## License

Apache-2.0. Parts of both mods are adapted from [ozcberkay/herdr-coban](https://github.com/ozcberkay/herdr-coban), also Apache-2.0. See the `NOTICE` file in each folder.
