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
opencode plugin @opencode-cockpit/trust@0.10.2 --global --force     # OpenCode 1
opencode plugin add @opencode-cockpit/trust@0.10.2                   # OpenCode 2
```

It only acts where OpenCode asks you — a `"bash": "ask"` (or `"permission": "ask"`) in
`opencode.json`. Where config already says `allow` or `deny`, OpenCode never asks, and Trust never
sees it.

## What counts as "the same command"

Exactly the same, and nothing wider — unless you widen it yourself, in the ledger (`w`), or it only
reads ([below](#reads-are-learned-as-a-family)).
`docker compose -p cockpit up -d` and
`docker compose -p prod down -v` are two commands — OpenCode's own "Always" would treat them as one
(`docker compose -p *`). The same command in another directory (`cd /tmp && rm -rf dist`) is
another command too. Quoting is the only thing normalised: `echo 'a b'` is `echo "a b"`.

A line with several commands (`git add -A && git commit -m wip`) counts for each of them, and is
answered only when **every** one is trusted — or allowed by your config. Anything that cannot be read
for certain is always yours to answer: `$(…)`, backticks, `$VAR`, `eval`, `sh -c`, a pipe into a
shell, a heredoc.

Each count is kept **per project**, whichever agent asked: `git status` approved while `build` ran
counts for `general`, `explore` and every subagent too — you give permission for the work in a
project, not for one agent in it. The ledger still records who asked. Other permissions have their
own notion of "the same" — see [OpenCode's own tools](#opencodes-own-tools).

## OpenCode's own tools

Read from OpenCode 1.18.33's tools: every permission they ask, and what Trust counts it by. They
only reach Trust when your config sets them to `ask`.

| Permission (tool) | Counted by | Family | Learned by itself | Suggested |
| --- | --- | --- | --- | --- |
| `bash` | the command, exactly | program and subcommand (`git status`) | its plain reads | yes |
| `edit` (`edit`, `write`, `apply_patch`) | the file | its folder (`src/`) | no | yes |
| `read` | the file | its folder (`read src/`) | yes | yes |
| `glob`, `grep` | the pattern | the whole tool (`any grep`) | yes | yes |
| `websearch` | the query | the whole tool | no — a query leaves the machine | yes |
| `webfetch` | the host | — | no | no |
| `todowrite`, `lsp` | one rule | — | no | no |
| `skill`, `task` | the skill, the subagent type | — | no | no |
| `external_directory`, `doom_loop` | never answered | | | |

A `read` of a file that may hold secrets (`.env`, a key, `~/.ssh`) is OpenCode's own default ask, and
stays yours to answer however often you approve it.

## Reads are learned as a family

An exact rule rarely repeats in real work: `head -3` on a new file, `rg` for a new word, one new
command in a line of five, and the whole line asks again. So a command that **only reads** counts
twice — for itself, and for its family. Three approved `head`s on three files, and any `head` that
only reads is answered, by a family Trust learned. `glob`, `grep` and `read` (by folder) are learned
the same way. The ledger marks the family
`reads` and its commands `✓ read`.

What reads: `ls`, `cat`, `head`, `tail`, `wc`, `grep`, `rg`, `fd`, `echo`, `jq`, `sort`, `cut`,
`diff`, `stat`, `eza` and the like; a `sed` whose script only prints (`sed -n 1,80p`, `s/a/b/g` —
never `w`, `e` or `-i`); a `git` that only looks (`status`, `log`, `diff`, `show`, `blame`,
`branch --show-current`, `stash list`, `worktree list`, `remote -v`, `config --get` …). It is an
allowlist: a program not on it is not a read, and keeps earning trust one command at a time.

A learned family covers plain reads only — never:

- a command with an env var or a wrapper in front (`LD_PRELOAD=… ls`, `sudo cat`, `xargs head`);
- one that writes: a redirection (`ls > out.txt`) or a flag (`sort -o`, `tree -o`, `uniq a b`);
- one that runs something: `rg --pre`, `fd -x`, `git --ext-diff`;
- anything dangerous;
- a file that may hold secrets: `.env`, `*.pem`, `*.key`, `id_rsa`, `~/.ssh`, `~/.aws`,
  `credentials` — `cat README.md` is in a learned `cat`, `cat .env` asks.

A reject of a read in the family starts it over; a reject of something it never covers
(`head .env`) does not. Unused for `expireDays`, it is gone. `w` on it — "Forget head reads" — takes
it back, until enough reads in a row teach it again. `"learnReads": false` turns it off: then only
the families you widen answer.

`awk`, `find`, `less` and `xargs` are not reads: their scripts and actions can write or run.

## Secrets stay out of the ledger

A command is written to the ledger, shown on screen and logged. A secret in it is replaced first,
with a keyed hash: `GITHUB_TOKEN=‹#3fa9c2› gh api …`. Masked:

- an env value under a name that says secret (`TOKEN`, `KEY`, `SECRET`, `PASSWORD`, `AUTH` …), or
  that looks generated, or is long;
- the value of `--token`, `--password`, `--api-key` and the like, and of `export NAME=…`;
- `Authorization:`, `Cookie:` and `X-Api-Key:` headers, `Bearer …`, and the password in
  `postgres://user:pass@host`;
- tokens by their shape, wherever they are: `sk-…`, `ghp_…`, `github_pat_…`, `xoxb-…`, `AKIA…`,
  `shpat_…`, a JWT.

Two different tokens stay two commands: trust earned with one is not trust for another. A masked
value keeps the environment it names — `DATABASE_URL=‹#a1b2c3 prod›` — so a production URL still
costs more and never shares a family with dev. `NODE_ENV=production` and `PORT=3000` stay as they
are. The key is per project, in `mask.key` beside the ledger, readable by you alone, so a short
password cannot be found by hashing guesses. OpenCode's own "always" patterns are masked too.

The ledger is only ever appended: lines written before 0.11 keep what they held. Delete them from
`events.ndjson` by hand if you want them gone.

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

## The ledger, and what Trust did

`/trust`, `ctrl+x p` or the palette opens on **the ledger**: every rule, as a tree of **families** —
`ls -la`, `ls -x` and `ls -R docs` are all `ls` — and a card for the one selected, always on screen.
Today's answers are one strip above it; `a` opens them in full.

```
 Trust · app                                    8 trusted · 2 learning · 6 seen once   ● answering
 Today  ✓ 5 answered · last 20:31 git status --short                                  [a] Activity
────────────────────────────────────────┬───────────────────────────────────────────────────────────
 COMMANDS                      / filter │ cat src/app.ts
 ▸ git  !                 1 ✓  1 ▰      │ ✓ Answered · through any cat …
 ▸ ls  reads              1 ✓           │
   bun test               ✓ trusted     │  Exactly     cat src/app.ts
 ▸ echo  reads            1 ✓           │  Still asks  dangerous ones, and any that write a file or
 ▾ cat  any               2 ✓           │              run another program.
▌    cat src/app.ts       ✓ any         │  History     answered 1×
     cat package.json     ✓ any         │              answered through any cat …, not by its own
 ▸ head  reads            1 ✓           │              count · last asked by general
   bun --version          ▰▰▱ 2/3       │  Family      cat · 2 commands, 2 trusted
 ▸ seen once  pwd  sed  … 6 ○           │              any cat … trusted 7d ago · [w] undoes it
                                        │
 EDITS                                  │
 ▸ src/  1 file           1 ✓           │
                                        │
 ! OpenCode always        2 broad rules │
                                        │  x Revoke    w Undo any cat    c Copy rule
────────────────────────────────────────┴───────────────────────────────────────────────────────────
 [↑/↓] Move   [←/→] Fold   [tab] Card   [/] Filter   [a] Activity   [?] Keys   …   [esc] Close
```

- **Each command is one row**, under its family, however many agents asked it: a rule is the
  project's. A family with one command is drawn as that row; others start folded, and an open
  family lists its first three commands and `+ N more`.
- **The card**: the command whole, on a raised panel; how it stands; exactly what it is, every
  argument quoted where a font could merge it (`echo "---"`, never `echo ──`, and said in words too:
  "3 hyphens"); what still asks; the **history** that earned it (`✓ 7d ✓ 7d ✓ 7d → trusted`) and
  which agent asked it last; its family and what `w` would do; when it expires. Its buttons — `x`,
  `w`, `c` — can be clicked, or reached with `tab`.
- **Below 90 columns** the card moves under the tree, the selection kept in view above it.
- **A family** is the program, or the program and its subcommand for tools that have them:
  `git status`, `docker compose up` (`-p prod` and other global flags are not part of it),
  `npm run test` (the script is). A wrapper is: `sudo ls` is not `ls`. So is where it runs and the
  environment it is given: `(in web) bun test`, `NODE_ENV=… npm run build`. An edit's family, and a
  read's, is its folder; a `grep` or a `glob` is one family, the tool.
- **`w` trusts the whole family**, in this project — on purpose, never by itself. Any `ls …` is
  then answered, **except** a dangerous command, one that writes a file through a redirection
  (`ls > out.txt`; `2>/dev/null` and `2>&1` write nothing and are fine) or a flag (`sed -i`,
  `perl -i`, `awk -i inplace`, `sort -o`, `tee file`, `curl -o`, `wget`, `tar x`, `unzip`,
  `find -delete`), one that runs another program (`find -exec`, `git -c`, `rg --pre`, `fd -x`), and
  any line that cannot be read. A specific `ask` in your config still wins. A dangerous family
  (`git push`, `rm`, `sudo …`) can never be widened. `w` again — or `x` on the family — goes back to
  exact rules. Answers through a widened family say so, on both screens, the sidebar
  (`● ls -x · any ls`) and the log.
- **Suggested families** sit at the top of the ledger, under **SUGGESTED**, when approvals across
  two or more commands of a family reach the threshold: `★ any mcpx db-local execute_sql?`. Its card
  says how many of today's approvals were in it. `w` widens it; `d` dismisses it for good. A
  dangerous family is never suggested, and a widening you undo is not suggested again. A suggestion
  never widens anything by itself.

```
 Trust · app                                   13 trusted · 1 learning · 5 seen once   ● answering
 Today  ✓ 4 answered · last 15:54 head -60 src/routes.ts                              [a] Activity
────────────────────────────────────────┬───────────────────────────────────────────────────────────
 SUGGESTED                     / filter │ mcpx db-local execute_sql  family of 3 commands
▌★ any mcpx db-local…?     3 in 3       │ ★ Suggested · 3 approvals in a row across 3 commands
                                        │
 COMMANDS                               │  Widen       [w] trusts any mcpx db-local execute_sql … —
 ▸ head  reads             5 ✓  1 ○     │              except dangerous ones, ones that write a file
 ▸ sed  reads              4 ✓  1 ○     │              and ones that run another program. [d] stops
 ▸ rg  reads               4 ✓          │              suggesting it.
   mcpx db-prod execu…  !  ▰▰▱▱▱▱▱▱ 2/8 │  Today       3 approvals of yours today were in it — [w] …
 ▸ mcpx db-local exec…     3 ○          │  Commands    mcpx db-local execute_sql --sql "se…  ○ once
                                        │
                                        │  w Trust any mcpx db-local execu…    d Dismiss
────────────────────────────────────────┴───────────────────────────────────────────────────────────
 [↑/↓] Move   [←/→] Fold   [tab] Card   [/] Filter   [a] Activity   [?] Keys   …   [esc] Close
```

**What Trust did** (`a`) is today's answers, newest first, each with the agent it answered and why;
a sparkline of the week; what is one approval away; and OpenCode's own broad "always" approvals in a
band of their own.

```
 Trust · app                                                                activity   ● answering

 TODAY  Trust answered 5 prompts for you                                       ▂▁▅▂█▄█  last 7 days
▌✓ 20:31  git status --short               build     trusted since Sep 16, 3 in a row
 ✓ 20:30  ls -la                           general   trusted since Sep 16, 3 in a row
 ✓ 20:21  bun test                         build     trusted since Sep 16, 3 in a row
 ✓ 20:13  git status --short && echo tr…   build     both commands trusted
 ✓ 19:43  cat src/app.ts                   general   in a family you widened: any cat …

 ALMOST THERE  closest first
 ○        bun --version                              ▰▰▱       2 of 3
 ○        git push origin feat/trust                 ▰▰▰▰▰▱▱▱  5 of 8   dangerous

  ! WATCH OUT   OpenCode's own "always" approves more than it looks, until it restarts
 !        find . *  sort -rn *             general    [enter] what it covers

 RULES  8 trusted · 2 learning · 6 seen once                                     l Open the ledger

 [enter] Why   [x] Revoke   [w] Trust Family   [a] Ledger   [p] Pause   [?] Keys   [esc] Back
```

- **Today**: every answer Trust gave in this project — from any window — with the time, the agent
  it answered, and why in a few words: the approvals that earned it and when, the family you widened,
  or the reads it learned. The same line answered again and again is one row with a count (`3×`).
  With nothing today, the latest from earlier days, with their day.
- **Almost there**: what is still learning, closest first, a dangerous command last. The meter is
  the approvals in a row that count (`▰`) and those still to go (`▱`); a dangerous one is red and
  longer (`threshold + dangerExtra`).
- **Watch out**: only when you gave OpenCode an "always" — it approves every command that starts
  that way until OpenCode restarts, and Trust cannot take it back.
- **`enter`** shows why: the card of that rule, in the ledger. **`a`** goes back to the ledger.

On the activity:

| Key | |
| --- | --- |
| `j` `k` `↑` `↓`, wheel, click | Move over answers, what is close, and OpenCode's own approvals |
| `enter` | Why: the rule's card in the ledger |
| `x` | Revoke what answered (the rule, or the widening that answered it); forget a count still learning |
| `w` | Trust any command in the family, or undo it |
| `c` | Copy it as an `opencode.json` rule, to paste yourself |
| `a`, `l`, click on the button | Back to the ledger |
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
| `x` | Revoke a command, or a family — every command in it, and its widening. Still learning, it forgets the count |
| `w` | Trust any command in the family, or undo it; on a learned family, forget it |
| `d` | Dismiss a suggestion: it is not suggested again in this project |
| `c` | Copy it as an `opencode.json` rule — a family as `"ls *": "allow"` |
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
| `learnReads` | `true` | Learn a family of plain reads by itself (`head`, `rg`, `git status` …); `false` leaves families to `w` |
| `enabled` | `true` | `false` turns Trust off (the bundle also has `features.trust: false`) |
| `sidebar` | `false` | Show the block in the sidebar. The palette's "Show or hide Trust in the sidebar" flips it for the session |
| `sidebarRows` | `3` | Answers listed in the sidebar |
| `keybinds` | `{ "cockpit.trust.ledger": "<leader>p" }` | The key that opens the ledger |

Where the block sits is the top-level `"sidebar"` list's to say — Trust last by default; a
`trust.sidebarOrder` from before 0.9 is not read, and `/cockpit-setup` removes it. A setting Trust
cannot use (`"threshold": "3"`) is a `!` row in the block. See
[Configuration](https://cockpit.codestz.dev/configuration/).

The ledger lives outside the project, in
`~/.local/share/opencode-cockpit/trust/<project>-<hash>/events.ndjson` (`$COCKPIT_HOME` or
`$XDG_DATA_HOME` move it): one line per event, appended, shared by every OpenCode window on the
project. Beside it, `mask.key` is the key secrets are hashed with; it is never in the ledger.

## See it without OpenCode

```sh
bunx @opencode-cockpit/trust preview
```

Draws the sidebar block, the activity and the ledger from sample projects, in your terminal —
`--sample learning` for learned reads and a suggestion,
`--view activity` or `--view ledger` for one screen, `--columns`/`--rows` for another size, `--html`
to judge the colours in a browser.

## Troubleshooting

```sh
npx opencode-cockpit@latest doctor
```

checks OpenCode, its config, Cockpit's logs and the daemon, and prints the fix for anything wrong
([what it checks](https://cockpit.codestz.dev/help/doctor/)).

```sh
tail -50 ~/.cache/opencode-cockpit/cockpit.log
```

shows every answer Trust gave and why; `COCKPIT_DEBUG=1 opencode` adds every request it looked at and
every reply it did not count.
