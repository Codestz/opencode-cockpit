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

A comment is anchored to **the lines it quoted**, never to a commit. Committing does not change the
code, only where git keeps it — so a comment anchored to a commit would be orphaned by the act it
most needs to survive, and every amend would rewrite the id it hung from. The commit is recorded on
the thread as provenance and nothing looks it up to find anything.

That gives three answers rather than two:

| | what it means | what happens |
| --- | --- | --- |
| **current** | the quoted lines are still where they were | nothing |
| **moved** | the same lines, elsewhere in the file | the comment follows the code; the agent is told the new line |
| **outdated** | the lines are not in the file at all | `[OUTDATED]`, muted, and **held back from a submit** |

The distinction matters in both directions. An edit above a comment must not make the comment look
broken, so *moved* re-anchors silently. A comment about code that no longer exists must stop being
handed over as work, so *outdated* is held back — and the panel says how many it held back, because
a comment that quietly did not go is worse than one that went.

The lines are matched as a block, never line by line. A single `}` matches in fifty places, and
re-anchoring to the wrong one is worse than admitting the comment is lost.

## When the file leaves the diff

Commit the work you were reviewing and the worktree diff empties. The comments are still true and
still on disk; what they lost is a file to be drawn against.

They appear at the foot of the file list, under the files that do have a diff, showing the code each
one quoted — which the thread has carried all along. Usually they are one source away: press
<kbd>b</kbd> for the branch view and they are back against real code.
