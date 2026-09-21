---
title: Reading a branch
description: The file tree, what the header counts, and keeping your place across a long review.
---

The panel is two halves: a tree of what changed on the left, the diff on the right. Whichever one does
not have the cursor is drawn dimmer, so the answer to "where am I" costs no border and no colour.

## The header

```text
 review   feat/review-bay → main   +7964 −6          0/68 read  │  7 open  │  3 resolved
```

Left: what you are reading, and how big it is. Right: what is left to do, in the order you run out of
it — how much you have read, how many comments are waiting on the agent, how many are finished.

"branch" is a category, not an answer, so the label says `feat/review-bay → main` for a branch review,
`uncommitted on main` for the worktree, and `this conversation` for a session.

## The tree

Folders with a single child are joined into one row, so `.github/workflows` is one line rather than
two. Additions and deletions line up in a column of their own down the right, sized to the widest
change in the review — the eye tracks one column instead of following ragged text.

| Key | Does |
| --- | --- |
| <kbd>j</kbd> <kbd>k</kbd> or arrows | Move |
| <kbd>return</kbd> <kbd>l</kbd> | Open a file, or fold a folder |
| <kbd>tab</kbd> | Switch to the diff |
| <kbd>space</kbd> | Mark read, and go to the next unread |

Clicking works too, in either half: a click in the list selects a file or folds a folder, a click in
the diff puts the cursor on a line, and the wheel scrolls whichever half it is over — which also makes
that half the active one.

## Marking read

<kbd>space</kbd> marks the file read and moves to the next one that is not. Reading a review is a
sweep, not a browse: the useful thing after finishing a file is the next file, not the file list.
Unmarking does not move you, because unmarking is a correction.

The header counts what you have read. Nothing else depends on it — it is for you, so you can put a
long review down and pick it up.

## The diff

Three tints, because a diff has three kinds of row and two colours would collapse two of them:

- the **gutter** of a changed line is the loudest, so the shape of a change reads down the margin
- the **row** is tinted faintly, so a long green block does not drown the code
- a **comment** sits on a surface of its own, belonging to neither side

Code is coloured the way the rest of OpenCode colours it, because the palette comes from your theme
rather than from us. Twelve filetypes are covered, and adding one is a row in a table —
[the language table](https://github.com/Codestz/opencode-cockpit/blob/main/packages/review/src/core/view/syntax/languages.ts)
is the file to edit.
