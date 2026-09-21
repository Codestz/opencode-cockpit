---
title: Review
description: A pull request in the terminal — comments the agent can read, answer and resolve.
---

Review turns what your agent wrote into something you can read the way you read a pull request: the
diff, comments on the lines they are about, and answers under them. Bay 02.

The difference from every other way of reviewing an agent's work is that **the comments are data, not
prose**. The agent fetches them with a tool, answers each one, and marks it resolved — and a resolve
is checked against the file before it is believed.

## The loop

```text
you                      the agent
───                      ─────────
read the diff
comment on a line
comment on a range
submit           ──────▶ review_list      what is waiting, with the code
                         (changes the code)
                 ◀────── review_reply     what it did, resolved=true
see the answer
in the panel
                 ◀────── review_open      a note of its own, for later
```

Four things make that a loop rather than a nicer diff viewer:

**Comments outlive the conversation.** They are stored per branch, not per chat. Start a new session,
switch branches and come back, close OpenCode — the review is where you left it, because a review is
about the *work*, not about the conversation you happened to be having.

**Submit is a handoff, not a paste.** It sends a short message; the notes travel as structured data
for `review_list` to fetch. Without the server half installed it sends the whole review as text
instead, so the loop degrades to a one-shot review rather than breaking.

**A resolve is checked.** A thread remembers the lines it was written against. If the agent says
"done" and the file still reads exactly as it did, the reply is kept and the thread stays open for
you, with the agent told plainly that nothing changed. Being told is the point: an agent that claims
a fix over an untouched file learns nothing, and you would have found out by reading.

**The agent can leave notes too.** `review_open` puts its own comment on a line — a bug noticed on the
way past, a decision that wants a second opinion, work it is deliberately leaving. It appears in the
panel beside yours and outlives the chat it was thought of in.

## When it beats reading the diff in chat

| The situation | In the conversation | In Review |
| --- | --- | --- |
| Three files changed, one is wrong | Describe the file, the line and the objection in prose | Put the comment on the line |
| You disagree with one decision | The whole turn gets re-litigated | One thread, on the lines it is about |
| Half the work is right | "Keep the first part, redo the second" | Resolve what is right, leave the rest open |
| You are interrupted | Scroll back and reconstruct where you were | The review is still there, with what you marked read |
| The agent says it fixed it | Take its word for it | Resolving is checked against the file |

Rule of thumb: **if you would have left a comment on a pull request, leave it here instead of
describing it.**

## What it reviews

Three sources, switched with <kbd>b</kbd>:

- **Uncommitted** — what is in the worktree now. The default, because that is what you are looking at
  nine times in ten: the work that just happened.
- **Branch** — this branch against its base, which is the pull-request reading.
- **This conversation** — only what this session changed, which is the smallest honest unit of "what
  did you just do".

## Getting it

```json
{
  "plugin": ["@opencode-cockpit/review"]
}
```

The package ships both halves: the panel you drive and the tools the agent gets. `<leader>v` opens
it — `<leader>` is OpenCode's own prefix, `ctrl+x` by default.
