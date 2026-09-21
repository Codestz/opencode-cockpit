---
title: Agent tools
description: The three tools the agent is given, and the rule that makes a resolve mean something.
---

Three tools, and each one is a thing a reviewer does: read what is waiting, answer it, or say
something of your own. Every per-thread argument takes an `id` **or** enough of the file and line to
be unambiguous, because an agent that has just read `config.ts:41` should not have to carry an opaque
id back to say something about it.

## review_list

What is waiting, with the code each comment was written against.

```json
{ "file": "src/core/config.ts", "status": "waiting" }
```

- `file` narrows to one file. A path suffix is enough.
- `status` is `waiting` (open and answered) or `all`, which includes resolved threads — the history of
  a file, for when that is the question.

Each thread comes back with its id, where it is, what was said by whom, its status, the lines as they
were when it was written, and whether the code has changed since.

## review_reply

Answers one comment, and says whether it is done.

```json
{ "id": "rv_0mgk2x1f4a", "text": "Named the file in the error and kept the original message.", "resolved": true }
```

One tool rather than a `reply` and a `resolve`, because they are the same act with a different ending:
the agent is always saying *something*, and sometimes that something closes the thread. A separate
resolve would invite resolving in silence, which is the one outcome nobody wants.

**`resolved: true` is a claim that gets checked.** A thread remembers the lines it was written
against. If they still read exactly as they did, the reply is kept, the thread stays open for you, and
the agent is told:

> Replied, but not resolved: `src/config.ts` still reads exactly as it did when the comment was
> written, so nothing was changed. The thread is waiting on the person now.

Disagreeing is a reply, not a silence — an agent that thinks a comment is wrong should say so and
leave it open, which is a different act from fixing it.

## review_open

A comment of the agent's own, on a line, a range, or a whole file.

```json
{ "file": "src/core/config.ts", "from": 40, "to": 52, "text": "Worth a test for the empty case." }
```

For things worth saying that are not what it was asked to do right now: a bug noticed on the way past,
a decision that wants a second opinion, work it is deliberately leaving behind. It writes through the
same store the panel reads, so a note the agent leaves is a note you see — and it is waiting on
**you**, exactly as a reply from it would be.

A note here outlives the conversation. It is on the branch, not in the chat, which is the point:
write the ones a future reader needs, not a running commentary.

## What the agent is told, once

Every conversation gets a few lines of guidance and, when something is actually waiting, one line
saying how much and in which files. Never the threads themselves — the list is a tool call away, and a
system prompt is not the place to put a review.

## Without the server half

The tools come from `@opencode-cockpit/review` itself, so a normal install has them. If the plugin is
running as a panel only, submit notices and sends the whole review as prose instead of naming tools
the agent does not have.
