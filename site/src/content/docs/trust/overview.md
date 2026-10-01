---
title: Trust
description: Permissions that learn — approve the exact same command a few times in a row and Trust answers for you, visibly, every time.
---

`"bash": "ask"` means approving `git status` for the hundredth time. OpenCode's own "Always" is
broader than it looks: it approves by prefix, and its prefixes count flags as words, so approving
`docker compose -p cockpit up -d` also approves `docker compose -p prod down -v`. Trust sits between:
you approve, it counts, and once you have approved the *exact same* command enough times in a row it
answers for you — and shows it, every time.

```sh
opencode plugin @opencode-cockpit/trust@0.7.1 --global --force     # OpenCode 1
opencode plugin add @opencode-cockpit/trust@0.7.1                   # OpenCode 2
```

Or through the bundle, where it is on by default (`features.trust: false` turns it off).

It only acts where OpenCode asks you — a `"bash": "ask"`, or `"permission": "ask"`, in
`opencode.json`. Where your config says `allow` or `deny`, OpenCode never asks, and Trust never sees
the request.

## The same command, exactly

| | the same as `git status`? |
| --- | --- |
| `git status` | yes |
| `git  status` (spacing), `git 'status'` (quoting) | yes |
| `git status -s` | no — another argument |
| `cd web && git status` | no — another directory |
| `git status` run by the `general` agent | no — another agent |

A line with several commands counts for each, and is answered only when **every** one is trusted or
allowed by your config: `git status && rm -rf build` waits for you even when `git status` is
trusted. Anything that cannot be read for certain is always asked and never counted: `$(…)`,
backticks, `$VAR`, `eval`, `sh -c`, a pipe into a shell, a heredoc.

Other permissions have their own "same": an edit by its file, a web fetch by its host, a subagent by
its type. `external_directory` and `doom_loop` are never answered.

## Earned, and lost

- **Three approvals in a row** (`threshold`) and it is trusted.
- **A reject resets** the count to nothing.
- **Dangerous commands cost more** — `threshold + dangerExtra`, eight by default: `rm`, `rmdir`,
  `dd`, `kill`, `chmod -R`, `git push`, `git reset --hard`, `git clean`, `git checkout -- …`,
  `git branch -D`, `docker rm`/`rmi`/`prune`, `docker compose down -v`, `kubectl delete`,
  `terraform apply`/`destroy`, `DROP`/`TRUNCATE` in a SQL client, `npm publish`, `--force`, and
  anything under `sudo`. `env`, `time`, `nohup`, `timeout` and `xargs` are looked through.
- **Unused for 30 days** (`expireDays`), it has to be earned again.
- **Only your approvals count.** Trust's own answers do not, and nor does any reply faster than
  300ms — nobody reads a prompt that fast; OpenCode's `--auto` answers in about 20ms.

## Your config always wins

A **specific** pattern set to ask — `"git push *": "ask"` — is you asking to be asked, and Trust
never answers a request it matches. A **catch-all** — `"bash": "ask"`, `{ "*": "ask" }`, or no rule
at all — is a default, and that is the gap Trust fills. Rules are read from OpenCode itself (the
merged config, the agent's own rules last), matched with OpenCode's wildcards, last match wins.

Trust never writes `opencode.json`. The ledger copies a rule for you to paste.

## In the sidebar

```
Trust                      4 auto
● git status                   7×
● edit src/app.ts              3×
○ docker compose -p cockpit…  2/3
```

A filled dot is something Trust answered in this window, with how many times it has answered it in
all; a hollow one is the request on screen now, and how far it is from being trusted. Nothing
answered and nothing counting, no block; paused, it says so; a failure always speaks. Every answer is
also a line in `~/.cache/opencode-cockpit/cockpit.log`. No toasts.

OpenCode's prompt is drawn for one frame (about 18ms) before Trust's answer removes it: a plugin
cannot get in before OpenCode's own handler.

## The ledger

`/trust`, `ctrl+x p`, or "Trust" in the palette:

```
 Trust in this project              3 in a row · dangerous +5 · unused 30 days expires

 ● git status                                  build    trusted · 6 auto  52m ago
 ● edit src/app.ts                             build    trusted · 2 auto  43m ago
 ○ docker compose -p cockpit logs -f api       build                 1/3   2d ago
 ○ git push origin feat/trust  git push        build                 5/8   2d ago

 OpenCode's own "always" — broader than it looks, and only until OpenCode restarts
 ! docker compose *                            build       until restart   2d ago

 [j/k] move   [x] revoke   [c] copy as config   [p] pause   [esc] close
```

| Key | |
| --- | --- |
| `j` `k` | Move |
| `x` | Revoke: it has to be earned again |
| `c` | Copy it as an `opencode.json` rule |
| `p` | Pause Trust in this project — it keeps counting and answers nothing; again to resume |
| `q` `esc` | Close |

## Settings

In the bundle's entry (`"trust": { … }`), the package's own, or the `trust` section of
`~/.config/opencode-cockpit/config.json` and a project's `.cockpit.json`:

| Setting | Default | |
| --- | --- | --- |
| `threshold` | `3` | Approvals in a row, by you, before Trust answers |
| `dangerExtra` | `5` | What a dangerous command costs on top |
| `expireDays` | `30` | Days unused before trust has to be earned again; `0` never |
| `enabled` | `true` | `false` turns Trust off |
| `sidebarRows` | `3` | Answers listed in the sidebar |
| `sidebarOrder` | `160` | Where the block sits in the sidebar; lower draws first |
| `keybinds` | `{ "cockpit.trust.ledger": "<leader>p" }` | The key that opens the ledger |

## Where it keeps what it learned

`~/.local/share/opencode-cockpit/trust/<project>-<hash>/events.ndjson` — outside the project, so it
never turns up in `git status` or travels to anyone who clones the repository. One line per event
(asked, approved by you, rejected, answered by Trust, revoked, paused), only ever appended, and shared
by every OpenCode window on the project. `$COCKPIT_HOME` or `$XDG_DATA_HOME` move it.

## See it without OpenCode

```sh
bunx @opencode-cockpit/trust preview
```
