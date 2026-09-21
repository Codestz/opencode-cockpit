---
title: Notes and threads
description: What a comment is attached to, what it remembers, and what happens when the code moves.
---

A comment is a **thread**: what was said, by whom, in order, with a status. It belongs to a file and
usually to a line or a range of lines, and it is stored on the branch rather than in the conversation.

## Writing one

<kbd>c</kbd> says something where you are standing. If there is already a thread there you are
answering it; if not you are starting one — the cursor already knows the difference, so it is one key
rather than two.

| Where the cursor is | What <kbd>c</kbd> does |
| --- | --- |
| A line in the diff | A comment on that line |
| A selection (<kbd>v</kbd>, then move) | A comment on those lines |
| A file in the list | A comment on the file as a whole |
| A thread | A reply to it |

<kbd>f</kbd> comments on the whole file from inside the diff, and <kbd>x</kbd> removes the thread you
are on — resolving is what the agent does, removing is what you do to a mistake.

Nothing is sent when you write it. The note is saved to disk as you submit the dialog, and reaches the
agent when you submit the review.

## What a thread remembers

The lines it was written against, as they read at the time. That is what lets the panel show the code
a comment is about even after the file moves on, and what makes a resolve checkable rather than a
matter of trust.

## Where they live

One JSON file per thread, under `XDG_DATA_HOME/opencode-cockpit/review/<project>-<branch>/`.

- **Keyed by branch, not by conversation.** You read a branch, leave notes, the agent answers, and
  somewhere in the middle you may well start a new chat. That should no more lose your review than it
  loses your branch.
- **Outside the project.** Not `.cockpit/` in the repo: a review is not part of the work, and the
  first time it turns up in someone's `git status` it becomes a thing to explain in a pull request.
- **Data, not cache.** Under `XDG_DATA_HOME` rather than the cache directory, because losing a
  half-finished review to a cache sweep is losing a half-finished job.

One file per thread means the panel and the agent are two writers who almost never touch the same
bytes, and a file that somehow goes bad costs one comment rather than the review.

## Status

| Status | Means | Waiting on |
| --- | --- | --- |
| **open** | You said something and nobody has answered | the agent |
| **answered** | The agent replied, or left a note of its own | you |
| **resolved** | Answered *and* the code actually changed | nobody |

Submit hands over what is waiting on the agent — a thread it already answered is your turn, and
handing it back would be asking for the same work twice.

## When the code moves

A thread whose quoted lines no longer read the same is marked as having moved, in the panel and in
what the agent is told. It is still readable and still answerable; the point of saying so is that an
answer about code that has changed may be answering a question that no longer exists.
