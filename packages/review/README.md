# @opencode-cockpit/review

**A pull request in the terminal.** Read what changed, hold your thoughts against the lines they
belong to, and send one review instead of six interruptions.

Part of [opencode-cockpit](https://github.com/Codestz/opencode-cockpit). Install it on its own, or
through the bundle.

```sh
opencode plugin @opencode-cockpit/review --global
```

## What it does

A turn ends having touched nine files. `ctrl+x v` puts the review over your conversation: the changed
files as a folder tree on the left, one file's diff beside it, syntax-highlighted in your own theme.

Read down a file. Something is wrong on line 40 — press `c`, say what you think, and carry on.
Nothing has happened yet; the agent does not know. Mark files off as you finish them and it moves you
to the next unread one. Nothing reaches the conversation until you submit, which is the entire point.

| key | |
| --- | --- |
| `ctrl+x v` | open, or close |
| `tab` | move between the file list and the diff |
| `j` / `k` | next / previous — a file on the left, a line on the right |
| `enter` | open a file, or fold a folder |
| `c` | comment on this line, or on this file |
| `x` | remove the note here |
| `space` | mark read, and go to the next unread |
| `s` | what is under review: branch → uncommitted → this conversation |
| `w` | half the window, or all of it |
| `q` | close |

The mouse works too: click a file or a folder in the list, and the wheel scrolls whichever side it is
over.

## What is under review

| | |
| --- | --- |
| **branch** | everything this branch changes against where it forked — what a reviewer would see. The default |
| **uncommitted** | everything not committed, *including files git has never seen* |
| **session** | what this conversation changed |

## Seeing it without OpenCode

```sh
bun packages/review/src/cli/preview.ts --fixture sprawl --width 200
```

Draws the whole view against sample change sets — forty files, a three-thousand-line file, a created
file, a deleted one — with no OpenCode running. This is where the design is made.

## Notes

- **The plugin never writes files.** One thing edits your code and it is the agent you are already
  watching — not a panel making changes behind its back.
- Code is highlighted by tree-sitter when the host's parser answers, and by a built-in tokenizer when
  it does not. The header says which, so a silent fallback cannot pass for the real thing.
- Line numbers are the file's own. A note that cites line 39 when the file says 40 is worse than no
  note at all.

[MIT](./LICENSE)
