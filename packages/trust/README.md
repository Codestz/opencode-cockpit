# @opencode-cockpit/trust

**Permissions that learn.** You approve a command yourself. After you have approved *the same
command* a few times in a row, Trust approves it for you — and shows it, every time. A reject resets
the count, a dangerous command costs more approvals, and nothing you told OpenCode to always ask
about is ever answered for you.

Part of [opencode-cockpit](https://github.com/Codestz/opencode-cockpit). Install it on its own, or
through the bundle. Works on OpenCode 1.18+ and 2.0.15+.

```sh
opencode plugin @opencode-cockpit/trust@0.7.1 --global --force     # OpenCode 1
opencode plugin add @opencode-cockpit/trust@0.7.1                   # OpenCode 2
```

It only acts where OpenCode asks you — a `"bash": "ask"` (or `"permission": "ask"`) in
`opencode.json`. Where config already says `allow` or `deny`, OpenCode never asks, and Trust never
sees it.

## What counts as "the same command"

Exactly the same, and nothing wider. `docker compose -p cockpit up -d` and
`docker compose -p prod down -v` are two commands — OpenCode's own "Always" would treat them as one
(`docker compose -p *`). The same command in another directory (`cd /tmp && rm -rf dist`) is
another command too. Quoting is the only thing normalised: `echo 'a b'` is `echo "a b"`.

A line with several commands (`git add -A && git commit -m wip`) counts for each of them, and is
answered only when **every** one is trusted — or allowed by your config. Anything that cannot be read
for certain is always yours to answer: `$(…)`, backticks, `$VAR`, `eval`, `sh -c`, a pipe into a
shell, a heredoc.

Each count is kept per project and **per agent**: `build` earning `git push` is not `general` earning
it. Other permissions have their own notion of "the same": an edit by its file, a web fetch by its
host, a subagent by its type. `external_directory` and `doom_loop` are never answered.

## What it will not touch

- **A specific `ask` in your config.** `"git push *": "ask"` means *always ask me*; Trust never
  answers a request it matches, however many times you approve it. A catch-all — `"bash": "ask"`,
  `{ "*": "ask" }`, or no rule at all — is a default, and that is the gap Trust fills.
- **Your config file.** Trust reads OpenCode's merged config through OpenCode; it never writes
  `opencode.json`. The ledger can copy a rule for you to paste.
- **Answers that were not yours.** A reply under 300ms is not a person's (OpenCode's `--auto` answers
  in about 20ms) and is not counted; neither are Trust's own answers.

## Dangerous commands cost more

`rm`, `git push`, `git reset --hard`, `--force`, `docker compose down -v`, `kubectl delete`,
`terraform apply`, `DROP` in a SQL client, `npm publish`, `sudo`, and the like need the normal
threshold **plus** `dangerExtra` approvals in a row — eight by default. They still earn trust; slowly.
`sudo`, `env`, `time`, `nohup`, `timeout` and `xargs` are looked through: `timeout 5 rm x` is `rm`.

## In the sidebar

```
Trust                      4 auto
● git status                   7×
● edit src/app.ts              3×
○ docker compose -p cockpit…  2/3
```

A filled dot is something Trust just answered, with how many times it has answered it in all; a
hollow one is a request on screen now and how far it is from being trusted. No answers and nothing
counting, no block. Each answer is also a line in `~/.cache/opencode-cockpit/cockpit.log`. No toasts.

## The ledger

`/trust`, `ctrl+x p` or the palette opens everything Trust has learned in this project: each command
with its agent, where its count stands, how often Trust answered it and when it was last used — and,
under a warning, the "Always" approvals you gave OpenCode itself, which are broader than they look
and last until OpenCode restarts.

| Key | |
| --- | --- |
| `j` `k` | Move |
| `x` | Revoke: it has to be earned again |
| `c` | Copy it as an `opencode.json` rule, to paste yourself |
| `p` | Pause Trust in this project (it keeps counting, and answers nothing) — again to resume |
| `q` `esc` | Close |

Trust unused for `expireDays` (30 by default) has to be earned again.

## Settings

In the bundle's entry (`"trust": { … }`), this package's own, or the `trust` section of
`~/.config/opencode-cockpit/config.json` and a project's `.cockpit.json`:

| Setting | Default | |
| --- | --- | --- |
| `threshold` | `3` | Approvals in a row, by you, before Trust answers |
| `dangerExtra` | `5` | What a dangerous command costs on top |
| `expireDays` | `30` | Days unused before trust has to be earned again; `0` never |
| `enabled` | `true` | `false` turns Trust off (the bundle also has `features.trust: false`) |
| `sidebarRows` | `3` | Answers listed in the sidebar |
| `sidebarOrder` | `160` | Where the block sits in the sidebar; lower draws first |
| `keybinds` | `{ "cockpit.trust.ledger": "<leader>p" }` | The key that opens the ledger |

The ledger lives outside the project, in
`~/.local/share/opencode-cockpit/trust/<project>-<hash>/events.ndjson` (`$COCKPIT_HOME` or
`$XDG_DATA_HOME` move it): one line per event, appended, shared by every OpenCode window on the
project.

## See it without OpenCode

```sh
bunx @opencode-cockpit/trust preview
```

Draws the sidebar block and the ledger from sample projects, in your terminal.

## Troubleshooting

```sh
npx opencode-cockpit@latest doctor
```

checks OpenCode, its config, Cockpit's logs and the daemon, and prints the fix for anything wrong
([what it checks](https://codestz.github.io/opencode-cockpit/help/doctor/)).

```sh
tail -50 ~/.cache/opencode-cockpit/cockpit.log
```

shows every answer Trust gave and why; `COCKPIT_DEBUG=1 opencode` adds every request it looked at and
every reply it did not count.
