# @opencode-cockpit/trust

**Permissions that learn.** You approve a command yourself. After you have approved *the same
command* a few times in a row, Trust approves it for you — and records it, every time. A reject resets
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

The block is **hidden by default** — the sidebar already carries the statusline, subagents and
shells, and Trust answers the same without it. `"trust": { "sidebar": true }` in
`~/.config/opencode-cockpit/config.json` or a project's `.cockpit.json` shows it; the palette's
"Show or hide Trust in the sidebar" flips it for this session only. Hidden or not, a failure — a
ledger that could not be saved — always shows there.

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
 Trust in this project                                                                   on

 Answers for you  9 commands                                        agent    answered  last
 ▸ ls  any ls … · 4 commands                                        general        4×   now
 ▸ git status  2 commands                                           build          2×    2m
 ● echo "---"  (3 hyphens)                                          general        1×    5m
 ● edit src/app.ts                                                  build     not yet    2d
 ● docker compose -p cockpit up -d                                  build     not yet    2d

 Learning  4 commands                                               agent    approved  last
 ○ edit src/view.ts                                                 build      2 of 3    2d
 ○ git status --short                                               general    2 of 3    2d
 ○ git push origin feat/trust  dangerous                            build      5 of 8    2d
 ○ docker compose -p prod down -v  dangerous                        build      2 of 8    2d
 + 4 more approved once · [a] lists them

 ls · any ls … answers for general · [i] details
 [space] Open   [x] Revoke   [w] Undo Any ls   [i] Details   [?] Keys   [esc] Close
```

`i` opens the details of the selected line in place of the quiet line — every fact, wrapped whole,
the list giving up the rows they need:

```
 ──────────────────────────────────────────────────────────────────────────────────────────
 Widened     any ls … for general — you widened it 15m ago.
 Still asks  dangerous ones, and any that write a file or run another program.
 To stop     [w] back to exact rules   [x] revokes it and its 4 rules
 [x] Revoke   [w] Undo Any ls   [a] Show All   [p] Pause   …   [esc] Hide Details
```

- **A family** is the program, or the program and its subcommand for tools that have them:
  `git status`, `docker compose up` (`-p prod` and other global flags are not part of it),
  `npm run test` (the script is). A wrapper is: `sudo ls` is not `ls`. So is where it runs and the
  environment it is given: `(in web) bun test`, `NODE_ENV=… npm run build`. An edit's family is its
  folder. A family with one rule is drawn as that one row; others start folded — `space`, `enter` or
  `→` opens one.
- **Two sections**: what Trust answers for you now, newest first, and what it is still learning,
  closest to trusted first. A command earned by one agent and still counting for another is a row
  in each.
- **One quiet line** under the list says what the selected line is. **`i`** opens its details:
  exactly what it is, with every argument quoted where a font could merge it (`echo "---"`, never
  `echo ──`), what it answers and what still asks, how far it has to go, how to stop it. An argument
  that is only punctuation is also said in words, beside its row and there (`(3 hyphens)`), because a
  ligature font merges `---` even inside quotes. **`?`** lists every key.
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
| `space` `enter` | Open or fold a family |
| `→` `l` / `←` `h` | Open a family / fold it — on a row inside one, go to its heading |
| `i` | Show or hide the details of the selected line |
| `x` | Revoke: a row for every agent on it; a family — every rule in it, and its widening. Still learning, it forgets the count |
| `w` | Trust any command in the family, or undo it |
| `c` | Copy it as an `opencode.json` rule, to paste yourself — a family as `"ls *": "allow"` (config cannot say which agent) |
| `a` | List the commands approved only once, or fold them again |
| `p` | Pause Trust in this project (it keeps counting, and answers nothing) — again to resume |
| `?` | Every key, one line each |
| `esc` | Close the details or the keys, then the ledger (`q` closes it too) |

The footer shows the keys that act on the selected line, `[i] Details` and `[?] Keys`; `c`, `a` and
`p` are in the details' row and the `?` list.

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
| `sidebar` | `false` | Show the block in the sidebar. The palette's "Show or hide Trust in the sidebar" flips it for the session |
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
