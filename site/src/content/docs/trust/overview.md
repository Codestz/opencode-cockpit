---
title: Trust
description: Permissions that learn — approve the exact same command a few times in a row and Trust answers for you, and records every answer.
---

`"bash": "ask"` means approving `git status` for the hundredth time. OpenCode's own "Always" is
broader than it looks: it approves by prefix, and its prefixes count flags as words, so approving
`docker compose -p cockpit up -d` also approves `docker compose -p prod down -v`. Trust sits between:
you approve, it counts, and once you have approved the *exact same* command enough times in a row it
answers for you — and records it, every time.

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

The block is **hidden by default**: the sidebar already carries the statusline, subagents and
shells, and Trust answers exactly the same without it — `/trust` shows what it did. To show it:

```json title="~/.config/opencode-cockpit/config.json (or a project's .cockpit.json)"
{ "trust": { "sidebar": true } }
```

"Trust: show or hide in the sidebar" in the command palette flips it for this session; it is not
remembered. Hidden or not, a failure — a ledger that could not be saved — always shows there.

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
 Trust in this project                 3 in a row · dangerous +5 · unused 30 days expires

 ▾ ls — any, widened                                                    4 trusted     now
     ● ls -la                              general               trusted · 3 auto  6m ago
     ● ls -la src                          general                        trusted  2d ago
     ● ls -x                               general               widened · 1 auto     now
     ● ls -R docs                          general                        widened  2d ago
 ▾ git status                              build, general               2 trusted  2m ago
     ● git status --short                  build, general   trusted, 2/3 · 2 auto  2m ago
     ● git -C packages/web status          build                          trusted  2d ago
 ● echo "---"  3 hyphens                   general               trusted · 1 auto  5m ago
 ▾ edit src/                                               1 trusted · 1 counting  2d ago
     ● edit src/app.ts                     build                          trusted  2d ago
     ○ edit src/view.ts                    build                              2/3  2d ago
 ● docker compose -p cockpit up -d         build                          trusted  2d ago
 ○ docker compose -p prod down -v  compos… build                              2/8  2d ago
 ○ git push origin feat/trust  git push    build                              5/8  2d ago
 + 4 approved once · [a] show all

 ────────────────────────────────────────────────────────────────────────────────────────
 Exactly   echo "---"  3 hyphens
 Answers   only this exact text, as general. Still asks: echo · echo "---" > out.txt

 [x] Revoke   [w] Trust Any echo   [c] Copy As Config   [a] Show All   …   [esc] Close
```

### Families

Rules are grouped by what they do. A **family** is the program — `ls`, `echo` — or, for a tool with
subcommands, the program and its subcommand: `git status`, `docker compose up`, `kubectl get`,
`terraform plan`. A package manager's `run` keeps its script: `npm run test` and `npm run deploy` are
two families.

| Command | Family |
| --- | --- |
| `ls -la`, `ls -x`, `ls -R docs` | `ls` |
| `git -C /x status --short` | `git status` |
| `docker compose -p prod down -v` | `docker compose down` |
| `npm run test` | `npm run test` |
| `sudo ls` | `sudo ls` — running as root is not `ls` |
| `cd web && bun test` | `(in web) bun test` |
| `NODE_ENV=prod npm run build` | `NODE_ENV=… npm run build` |
| `ls > out.txt` | `ls` |
| edit `src/app.ts` | `edit src/` |

A family with one rule is drawn as that row; the others start folded, with how many of their rules
are trusted and how many counting. `enter` opens one. A command two agents earned is one row naming
both, each with its own count: `git status --short  build, general  trusted, 2/3`.

### Exactly

The panel under the list says what the selected line is, with every argument quoted where a font
could merge it: a programming font draws `---` as one line, so `echo ---` is shown `echo "---"`; so
are `->`, `==`, `!=`, `<=`, `>=`, `www` and any word that is only punctuation. Quotes are not
enough on their own — a ligature font still merges `---` inside them — so an argument that is only
punctuation is also said in words, beside its row in the list and here: `echo "---"  3 hyphens`,
`hyphen, greater-than` for `->`. Then a sentence: what it answers, as which agent, and what still
asks. On a family: what it holds, and what `w` would do.

### Trusting a whole family

`w` trusts any command in the family, for the agent of the selected rule. It is the one way trust
gets wider than what you approved, and only you do it — it is written to the ledger like everything
else. From then on any `ls …` is answered for that agent, **except**:

- a dangerous command — `docker compose down -v` is not covered by `docker compose down`;
- one that writes a file through a redirection — `ls > out.txt` (`2>/dev/null` and `2>&1` write
  nothing, and are covered);
- one that runs another program — `find -exec`, `git -c …`;
- a line that cannot be read, and anything a specific `ask` in your config matches.

A dangerous family — `git push`, `rm`, `kubectl delete`, `sudo …` — can never be widened: `w` says
why and does nothing. `w` again, or `x` on the family, goes back to exact rules. An answer through a
widened family says so: `widened` in the ledger, `● ls -x · any ls` in the sidebar, the family in
the log. Widening does not expire; undo it when you no longer want it.

| Key | |
| --- | --- |
| `j` `k` `↑` `↓`, wheel | Move over families and rows |
| `enter` | Open or fold a family |
| `x` | Revoke: a row for every agent on it; on a family, every rule in it and its widening |
| `w` | Trust any command in the family, or undo it |
| `c` | Copy it as an `opencode.json` rule — a family as `"ls *": "allow"`, which config cannot limit to one agent |
| `a` | List the commands approved only once, or fold them again |
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
| `sidebar` | `false` | Show the block in the sidebar. The palette's "Trust: show or hide in the sidebar" flips it for the session |
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
