# @opencode-cockpit/review

**A pull request in the terminal.** Read what changed, hold your thoughts against the lines they
belong to, and send one review instead of six interruptions.

Part of [opencode-cockpit](https://github.com/Codestz/opencode-cockpit). Install it on its own, or
through the bundle.

```sh
opencode plugin @opencode-cockpit/review --global
```

## What it does

A turn ends having touched nine files. `ctrl+x v` — or `/changes` — puts the review over your
conversation: the changed files as a folder tree on the left, one file's diff beside it,
syntax-highlighted in your own theme.

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
| `j` / `k` | next / previous — a file on the left, a line on the right |
| `enter` | open a file, or fold a folder |
| `v` | start a selection, for a note about several lines |
| `c` | comment here, or reply to the thread here |
| `f` | comment on the whole file |
| `x` | remove the note here |
| `space` | mark read, and go to the next unread |
| `s` | **submit** — hand the review to the agent |
| `b` | what is under review: uncommitted → branch → this conversation |
| `w` | half the window, or all of it |
| `p` | what the panel is costing, in the footer |
| `q` | close |

The mouse works too: click a file or a folder in the list, and the wheel scrolls whichever side it is
over.

## What is under review

| | |
| --- | --- |
| **uncommitted** | everything not committed, *including files git has never seen*. The default, because it is what you are looking at nine times in ten |
| **branch** | everything this branch changes against where it forked — what a reviewer would see |
| **session** | what this conversation changed |

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
