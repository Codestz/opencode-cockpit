# @opencode-cockpit/review

**A pull request in the terminal.** Read what changed, hold your thoughts against the lines they
belong to, and send one review instead of six interruptions.

Part of [opencode-cockpit](https://github.com/Codestz/opencode-cockpit). Install it on its own, or
through the bundle.

```sh
opencode plugin @opencode-cockpit/review@0.5.2 --global --force
```

## What it does

A turn ends having touched nine files. `ctrl+x v` — or `/changes` — puts the review over your
conversation: the changed files as a folder tree on the left and, beside it, **every file's diff in
one scroll** the way a pull request reads, syntax-highlighted in your own theme. Each file is a card,
as on GitHub — a bordered block with a raised heading you can fold; the heading of the file you are in stays pinned to the top; marking a file
viewed folds it out of the way. Only what is on screen is ever drawn, so a two-hundred-file review
scrolls as smoothly as a two-file one.

Read down a file. Something is wrong on line 40 — press `c`, say what you think, and carry on.
Nothing has happened yet; the agent does not know. Mark files off as you finish them and it moves you
to the next unread one. Nothing reaches the conversation until you press `s`, which is the entire
point.

Then the agent reads them **as data**: `review_list` hands it every comment with the code each one is
about, it changes what needs changing, and answers with `review_reply resolved=true`. A resolve is
checked — a thread remembers the lines it was written against, so "done" over an untouched file is
recorded as a reply, the thread stays open for you, and the agent is told why. It can leave notes of
its own with `review_open`, which appear in the panel beside yours.

| key | |
| --- | --- |
| `ctrl+x v` | open, or close |
| `tab` | move between the file list and the diff |
| `j` / `k` | next / previous — a file on the left; on the right a line, running on into the next file |
| `enter` | on the left: jump to a file, or fold a folder. On the right: fold or unfold this file |
| `z` | fold or unfold the file you are in |
| `v` | start a selection, for a note about several lines |
| `c` | comment here, or reply to the thread here |
| `f` | comment on the whole file |
| `x` | remove the note here |
| `space` | mark viewed — it folds — and go to the next unviewed file |
| `s` | **submit** — hand the review to the agent |
| `b` | what is under review: uncommitted ↔ branch |
| `B` | what the branch is compared against: its nearest parent, or one you pick |
| `w` | half the window, or all of it |
| `p` | what the panel is costing, in the footer |
| `q` | close |

The mouse works too: click a file in the list to jump to it, click a heading to fold it, or its
`+ note` / `[ ] viewed` buttons; the wheel scrolls whichever side it is over.

## What is under review

| | |
| --- | --- |
| **uncommitted** | everything not committed, *including files git has never seen*. The default, because it is what you are looking at nine times in ten |
| **branch** | everything this branch changes against its *nearest parent* — what its pull request would show. On `main ← feature ← X`, X is compared with `feature`, not `main`. `B` picks a different base, remembered per branch |

## Seeing it without OpenCode

```sh
bun packages/review/src/cli/preview.ts --fixture sprawl --width 200
```

Draws the whole view against sample change sets — forty files, a three-thousand-line file, a created
file, a deleted one — with no OpenCode running. This is where the design is made.

## When the code moves

A comment is anchored to the **lines it quoted**, not to a commit — because committing does not
change the code, only where git keeps it, and a comment anchored to a commit would be orphaned by the
act it most needs to survive.

So a comment follows its code when the code moves, and says `[OUTDATED]` when the lines are gone
entirely. An outdated comment stays readable and answerable but is held back from a submit: it is
history, not work, and the panel says how many it held back rather than dropping them quietly.

Comments whose file has left the diff — you committed the work you were reviewing — sit at the foot
of the file list, with the code each one quoted, rather than disappearing.

## Where the comments live

One JSON file per thread, under `XDG_DATA_HOME/opencode-cockpit/review/<project>-<branch>/`. Keyed by
branch, not by conversation: you read a branch, leave notes, the agent answers, and somewhere in the
middle you may well start a new chat. That should no more lose your review than it loses your branch.

Outside the project, because a review is not part of the work — the first time it turns up in
someone's `git status` it becomes a thing to explain in a pull request.

## Notes

- **The plugin never writes files.** One thing edits your code and it is the agent you are already
  watching — not a panel making changes behind its back.
- Code is coloured by a table of languages, from your own theme, so a review looks like the editor it
  is running inside. Adding a filetype is a row in that table.
- Line numbers are the file's own. A note that cites line 39 when the file says 40 is worse than no
  note at all.

[MIT](./LICENSE)

## Troubleshooting

```sh
npx opencode-cockpit@latest doctor
```

checks OpenCode, its config, Cockpit's logs and the daemon, and prints the fix for anything wrong —
on OpenCode 1 and 2, and when Cockpit will not load at all ([what it checks](https://codestz.github.io/opencode-cockpit/help/doctor/)).

Everything Cockpit does inside OpenCode goes to one file — which OpenCode loaded which bay, and every
error with its stack:

```sh
tail -50 ~/.cache/opencode-cockpit/cockpit.log
```

`COCKPIT_DEBUG=1 opencode` adds the detail. [Troubleshooting](https://codestz.github.io/opencode-cockpit/help/troubleshooting/) covers
the failures people hit and what to attach to an issue; [OpenCode 1 and 2](https://codestz.github.io/opencode-cockpit/start/opencode-versions/)
covers what differs between the two.
