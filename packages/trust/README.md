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

Exactly the same, and nothing wider — unless you widen it yourself, in the ledger (`w`).
`docker compose -p cockpit up -d` and
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

`/trust`, `ctrl+x p` or the palette opens everything Trust has learned in this project, grouped into
**families** — `ls -la`, `ls -x` and `ls -R docs` are all `ls`:

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
 ● echo "---"                              general               trusted · 1 auto  5m ago
 ▾ edit src/                                               1 trusted · 1 counting  2d ago
     ● edit src/app.ts                     build                          trusted  2d ago
     ○ edit src/view.ts                    build                              2/3  2d ago
 ● docker compose -p cockpit up -d         build                          trusted  2d ago
 ○ docker compose -p prod down -v  compos… build                              2/8  2d ago
 ○ git push origin feat/trust  git push    build                              5/8  2d ago
 + 4 approved once · [a] show all

 ────────────────────────────────────────────────────────────────────────────────────────
 Exactly   echo "---"
 Answers   only this exact text, as general. Still asks: echo · echo "---" > out.txt

 [x] Revoke   [w] Trust Any echo   [c] Copy As Config   [a] Show All   …   [esc] Close
```

- **A family** is the program, or the program and its subcommand for tools that have them:
  `git status`, `docker compose up` (`-p prod` and other global flags are not part of it),
  `npm run test` (the script is). A wrapper is: `sudo ls` is not `ls`. So is where it runs and the
  environment it is given: `(in web) bun test`, `NODE_ENV=… npm run build`. An edit's family is its
  folder. A family with one rule is drawn as that one row; others start folded — `enter` opens one.
- **One row per command**, even when two agents earned it: `git status --short  build, general
  trusted, 2/3`. Counting stays per agent.
- **Exactly** says what the selected line is with every argument quoted where a font could merge it
  (`echo "---"`, never `echo ──`), and in a sentence what it answers and what still asks.
- **`w` trusts the whole family**, for the selected rule's agent — on purpose, never by itself. Any
  `ls …` is then answered for that agent, **except** a dangerous command, one that writes a file
  through a redirection (`ls > out.txt`; `2>/dev/null` and `2>&1` write nothing and are fine), one
  that runs another program (`find -exec`, `git -c`), and any line that cannot be read. A specific
  `ask` in your config still wins. A dangerous family (`git push`, `rm`, `sudo …`) can never be
  widened. `w` again — or `x` on the family — goes back to exact rules. Answers through a widened
  family say so, in the ledger, the sidebar (`● ls -x · any ls`) and the log.

| Key | |
| --- | --- |
| `j` `k` `↑` `↓`, wheel | Move over families and rows |
| `enter` | Open or fold a family |
| `x` | Revoke: a row for every agent on it; a family — every rule in it, and its widening |
| `w` | Trust any command in the family, or undo it |
| `c` | Copy it as an `opencode.json` rule, to paste yourself — a family as `"ls *": "allow"` (config cannot say which agent) |
| `a` | List the commands approved only once, or fold them again |
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
