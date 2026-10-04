# @opencode-cockpit/trust

**Permissions that learn.** You approve a command yourself. After you have approved *the same
command* a few times in a row, Trust approves it for you — and records it, every time. A reject resets
the count, a dangerous command costs more approvals, and nothing you told OpenCode to always ask
about is ever answered for you.

<img src="https://raw.githubusercontent.com/Codestz/opencode-cockpit/main/media/trust.gif" width="760" alt="Trust learning bun test: three approvals, then Trust answers it, and ctrl+x p shows what it answered">

*Drawn by the bay's own renderer — the same code that runs in your terminal.*

Part of [opencode-cockpit](https://github.com/Codestz/opencode-cockpit). Install it on its own, or
through the bundle. Works on OpenCode 1.18+ and 2.0.15+.

```sh
opencode plugin @opencode-cockpit/trust@0.9.0 --global --force     # OpenCode 1
opencode plugin add @opencode-cockpit/trust@0.9.0                   # OpenCode 2
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

## What Trust did, and the ledger

`/trust`, `ctrl+x p` or the palette opens on **what Trust did for you**: today's answers, newest
first, each with why it was answered; a sparkline of the week; what is one approval away; and
OpenCode's own broad "always" approvals in a band of their own.

```

 Trust · app                                                                           ● answering

 TODAY  Trust answered 5 prompts for you                                       ▂▁▅▂█▄█  last 7 days
▌20:31  ✓ git status --short               build     trusted since Sep 16, 3 in a row
 20:30  ✓ ls -la                           general   trusted since Sep 16, 3 in a row
 20:21  ✓ bun test                         build     trusted since Sep 16, 3 in a row
 20:13  ✓ git status --short && echo tr…   build     both commands trusted
 19:43  ✓ cat src/app.ts                   general   in a family you widened: cat

 ALMOST THERE  closest first
  ○ bun --version                          build     ▰▰▱       2 of 3
  ○ git status --short -uno                general   ▰▰▱       2 of 3
  ○ head -60                               general   ▰▰▱       2 of 3
  ○ head -40                               general   ▰▰▱       2 of 3
  ○ git push origin feat/trust             build     ▰▰▰▰▰▱▱▱  5 of 8   dangerous

  ! WATCH OUT   OpenCode's own "always" approves more than it looks, until it restarts
  ! find . *  sort -rn *                   general    [enter] what it covers

 RULES  8 trusted · 5 learning · 7 seen once                                     l Open the ledger

 [enter] Why   [x] Revoke   [w] Trust Family   [l] Ledger   [p] Pause   [?] Keys   [esc] Close
```

- **Today**: every answer Trust gave in this project — from any window — with the time, the agent
  and why in a few words: the approvals that earned it and when, or the family you widened. The same
  line answered again and again is one row with a count (`3×`). With nothing today, the latest from
  earlier days, with their day.
- **Almost there**: what is still learning, closest first, a dangerous command last. The meter is
  the approvals in a row that count (`▰`) and those still to go (`▱`); a dangerous one is red and
  longer (`threshold + dangerExtra`).
- **Watch out**: only when you gave OpenCode an "always" — it approves every command that starts
  that way until OpenCode restarts, and Trust cannot take it back.
- **`enter`** shows why: the card of that rule, in the ledger. **`l`** opens the ledger.

**The ledger** (`l`) is every rule, as a tree of **families** — `ls -la`, `ls -x` and `ls -R docs`
are all `ls` — and a card for the one selected, always on screen:

```
 Trust · app                                    8 trusted · 5 learning · 7 seen once   ● answering
────────────────────────────────────────┬───────────────────────────────────────────────────────────
 FAMILIES                    1–15 of 18 │ git status --short
 ▾ git status              1 ✓  1 ○     │ ✓ Trusted for  build  · answered 8×
▌    … --short             ✓ trusted 8× │
     … --short -uno        ▰▰▱ 2 of 3   │  Exactly     git status --short
   ls -la                  ✓ trusted 2× │  Still asks  git status · git status --short > out.txt ·
   bun test                ✓ trusted 2× │              any other argument
   echo trust-test         ✓ trusted 3× │  History     ✓ 7d  ✓ 7d  ✓ 7d  → trusted  answered 8×
 ▸ cat  any                2 ✓          │              3 approvals in a row, all yours
 ▸ head                    1 ✓  3 ○     │  Family      git status · 2 commands, 1 trusted
   edit src/app.ts         ✓ trusted 2× │              [w] trusts any git status … for build, not
   bun --version           ▰▰▱ 2 of 3   │              one by one
   git push origin fe…  !  ▰▰▰▰▰▱▱▱ 5/8 │  Expires     if unused for 30 days
   pwd                     ▰▱▱ 1 of 3   │
   sed -n 1,40p src/a…     ▰▱▱ 1 of 3   │  x Revoke    w Trust any git status    c Copy rule
   wc -l src/app.ts        ▰▱▱ 1 of 3   │
   sort -rn                ▰▱▱ 1 of 3   │
────────────────────────────────────────┴───────────────────────────────────────────────────────────
 [↑/↓] Move   [←/→] Fold   [tab] Card   [/] Filter   [p] Pause   [?] Keys   [esc] Back
```

- **Each command is one row**, under its family, whatever its agents say about it; the card lists
  each agent's standing. A family with one command is drawn as that row; others start folded, and
  an open family lists its first three commands and `+ N more`.
- **The card**: the command whole, on a raised panel; where each agent stands; exactly what it is,
  every argument quoted where a font could merge it (`echo "---"`, never `echo ──`, and said in words
  too: "3 hyphens"); what still asks; the **history** that earned it (`✓ 7d ✓ 7d ✓ 7d → trusted`);
  its family and what `w` would do; when it expires. Its buttons — `x`, `w`, `c` — can be clicked,
  or reached with `tab`.
- **Below 90 columns** the card moves under the tree, the selection kept in view above it.
- **A family** is the program, or the program and its subcommand for tools that have them:
  `git status`, `docker compose up` (`-p prod` and other global flags are not part of it),
  `npm run test` (the script is). A wrapper is: `sudo ls` is not `ls`. So is where it runs and the
  environment it is given: `(in web) bun test`, `NODE_ENV=… npm run build`. An edit's family is its
  folder.
- **`w` trusts the whole family**, for the selected command's agent — on purpose, never by itself.
  Any `ls …` is then answered for that agent, **except** a dangerous command, one that writes a file
  through a redirection (`ls > out.txt`; `2>/dev/null` and `2>&1` write nothing and are fine), one
  that runs another program (`find -exec`, `git -c`), and any line that cannot be read. A specific
  `ask` in your config still wins. A dangerous family (`git push`, `rm`, `sudo …`) can never be
  widened. `w` again — or `x` on the family — goes back to exact rules. Answers through a widened
  family say so, on both screens, the sidebar (`● ls -x · any ls`) and the log.

On the activity:

| Key | |
| --- | --- |
| `j` `k` `↑` `↓`, wheel, click | Move over answers, what is close, and OpenCode's own approvals |
| `enter` | Why: the rule's card in the ledger |
| `x` | Revoke what answered (the rule, or the widening that answered it); forget a count still learning |
| `w` | Trust any command in the family, or undo it |
| `c` | Copy it as an `opencode.json` rule, to paste yourself |
| `l`, click on the button | Open the ledger |
| `/` | Open the ledger and filter it |
| `p` | Pause Trust in this project (it keeps counting, and answers nothing) — again to resume |
| `?` | Every key, one line each |
| `esc` | Close (`q` too) |

In the ledger:

| Key | |
| --- | --- |
| `j` `k` `↑` `↓`, wheel, click | Move over families and commands |
| `←` `h` / `→` `l` | Fold / open a family — on a command inside one, go to its heading |
| `space` `enter` | Open or fold a family; on `+ N more`, list the rest |
| `tab` | Into the card's buttons and back; `←` `→` choose one, `enter` presses it |
| `x` | Revoke a command for every agent, or a family — every command in it, and its widening. Still learning, it forgets the count |
| `w` | Trust any command in the family, or undo it |
| `c` | Copy it as an `opencode.json` rule — a family as `"ls *": "allow"` (config cannot say which agent) |
| `/` | Filter by text; `enter` keeps it, `esc` clears it |
| `p` | Pause or resume |
| `?` | Every key, one line each |
| `esc` | One step back: the keys, the card's buttons, the filter — then to the activity, which `esc` closes |

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
| `keybinds` | `{ "cockpit.trust.ledger": "<leader>p" }` | The key that opens the ledger |

Where the block sits is the top-level `"sidebar"` list's to say — Trust last by default; a
`trust.sidebarOrder` from before 0.9 is no longer read, and is a `!` row in the block until
`/cockpit-setup` removes it. A setting Trust cannot use (`"threshold": "3"`) is a `!` row too. See
[Configuration](https://codestz.github.io/opencode-cockpit/configuration/).

The ledger lives outside the project, in
`~/.local/share/opencode-cockpit/trust/<project>-<hash>/events.ndjson` (`$COCKPIT_HOME` or
`$XDG_DATA_HOME` move it): one line per event, appended, shared by every OpenCode window on the
project.

## See it without OpenCode

```sh
bunx @opencode-cockpit/trust preview
```

Draws the sidebar block, the activity and the ledger from sample projects, in your terminal —
`--view activity` or `--view ledger` for one screen, `--columns`/`--rows` for another size, `--html`
to judge the colours in a browser.

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
