---
title: Subagents
description: Every subagent in the sidebar with what it is doing now, its whole run a click away, and follow-ups that keep its context.
---

When the main agent hands work to a subagent, OpenCode shows one line in the chat — "General
Subagent — Fix the login test" — and nothing about what it is doing. Subagents makes them visible,
reachable and reusable, on OpenCode 1 and 2 alike.

```sh
opencode plugin @opencode-cockpit/subagents@0.8.0 --global --force     # OpenCode 1
opencode plugin add @opencode-cockpit/subagents@0.8.0                   # OpenCode 2
```

Or through the bundle, where it is on by default.

## In the sidebar

A **Subagents** block: every subagent of the conversation you are in, its type and task, and under
it what it is doing now — with how many calls and how long the whole run has taken on the right.
Working ones come first, oldest first, so a late runner never sits under a pile of finished ones.

```
Subagents    1 running · 1 needs you
⠹ explore Map the authentication fl…
  └ grep "session" sr… 6 calls · 51s
○ Fix the failing login test
  └ waiting for permi… 3 calls · 50s
● Update README for t… 3 calls · 28s
```

A spinner is working and `○` waits on you — the two in colour, because they are the two that may
need you; a red `●` failed. A finished subagent is a quiet `●` and one row; one you stopped says
`stopped`, quietly too, since stopping is not failing. The heading counts every state, and keeps
what needs you when the column is narrow. Every row names its agent, muted — `general` too — and
the agent's name shortens before the title does; a subagent with no title is named by its task's
first words. A subagent that launched its own has them indented under it, and subagents with the
same parent, agent and task — a helper asked again and again — are one entry with a count (`×6`). A
finished nested one leaves the sidebar after `hideNestedAfterSeconds` (30 by default); the heading
still counts it and the pane still reaches it. Working subagents are always shown; finished ones
fold into a count past `sidebarRows`, and leave after `hideFinishedAfterMinutes` if you set it. With
none yet the block says so — its heading and `none yet` — unless `hideWhenEmpty` is on.

The sidebar reads status, subagents, shells, trail, top to bottom — `"sidebar"` in
[Cockpit's config](/opencode-cockpit/configuration/#the-sidebar-order) reorders it.

## The pane

Click a subagent — or press `ctrl+x d`, or run `/subagents` for the one working now — and its run
opens in a pane on the right: half the window, or all of it with `w`. A click outside closes it.

Under its name: the model, whether it runs in the background, who launched it, and its calls, steps
and tokens so far. Then the run, the way OpenCode draws its own:

- **the task** the main agent gave it, as a card at the top;
- **its thinking** — "Thought · 1.2s" and the words, folded to one line with `t`;
- **a shell command or a file change** as a box: the command, then its output — ten lines folded,
  sixty open, all of it with `a` — and a row that says what is hidden and the key that shows it
  (`… 2 more lines · [enter] Expand`); red when it failed;
- **reads, searches and fetches** as one quiet line each — `→ Read src/auth/session.ts`,
  `✱ Grep "session"  9 matches` — that open into a box of their arguments and output; `webfetch`
  and `websearch` show the URL or the query;
- **a task** names the subagent it launched, and `enter` goes there; **todos** are a checklist; an
  **MCP tool** is titled `server · tool`; anything else is boxed once its arguments are large;
- **its answer**, drawn as markdown as it is written — emphasis, links, and a code fence's language
  on its first row.

**Arguments climb the same ladder as output.** Each one shows three rows folded, sixty open and up to
two thousand with `a`, always saying `… N more lines`, so a long question to an advisor can be read
in full. A short value is one row, a long string is markdown under its name (verbatim for file
tools), and an object is indented JSON. Thinking is drawn as markdown too, muted.

Every item is selectable: `j` `k` move the cursor, `enter` or a click opens or folds. The pane follows
the run as it grows; scroll or move the cursor and it stays where you put it until `G`.

| Key | |
| --- | --- |
| `j` `k` | Move the cursor through the run's items |
| `enter` · a click | Open or fold the item under it |
| `e` | Open, or fold, every call |
| `a` | A call's whole output and arguments — open shows the first 60 lines, whole up to 2,000 |
| `t` | Show or hide thinking — shown by default, and remembered |
| `m` | Write it a message, at the foot of the pane (pasting works) |
| `x` | Stop it (press twice) — or, once it has finished, remove it from the list |
| `X` | Remove every finished subagent from the list |
| `b` | Move it to the background, so the main agent carries on (OpenCode's own `ctrl+b`) |
| `i` | Details: model, what it is denied, calls by tool, tokens, cost |
| `w` | Half the window, or all of it (remembered) |
| `[` `]` | Another subagent of this conversation |
| `d` `u` · `g` `G` | Page down · up · to the start · follow the run |
| `esc` `q` | Back to the conversation |

## Follow-ups keep their context

A subagent that already read the code does a follow-up in seconds; a new one starts from nothing.
Cockpit asks the main agent to continue the subagent that did the work — OpenCode 1's `task_id`,
OpenCode 2's `sessionID` — rather than launch a new one, and gives it three tools for when the id has
scrolled out of its context:

| Tool | What it answers |
| --- | --- |
| `subagents_list` | Each subagent's id, task, state — with when it ended, by the clock — and last answer; says when one was cancelled, or ended on a progress note rather than an answer |
| `subagents_read id [after]` | One subagent in full: why it stopped, its task, its whole final answer, and every call it made — paged with a cursor. Works on cancelled ones, which can be continued |
| `subagents_wait [ids] [any] [timeoutSeconds]` | Blocks until background subagents finish, fail, are cancelled or stop on a permission — never longer than its timeout — and returns each one's state and answer |

The tools, the pane and the sidebar state a run's title, calls, state and duration from the same
functions, so what the agent is told is what you see.

So you just ask, in the main conversation: *"the review missed the refresh flow — get that checked
too."* Each new round shows in the pane under a "Round 2" rule, with who started it — "build
continued it", or "You" — and the sidebar counts rounds.

## Messaging a subagent

Press `m` and write at the foot of the pane; `enter` sends, `esc` lets it go. Measured on both
OpenCodes:

- **While it works**, it picks the message up in its current run, acts on it, and says so in its
  answer — which the main agent receives.
- **Once it has finished**, it wakes up and answers you. Cockpit then adds what you asked and what it
  answered to the main conversation *without starting a turn there* — OpenCode 1 shows it as a
  message, OpenCode 2 as a "Subagent exchange" line — so the main agent knows the next time you talk
  to it.
- **If it finishes without reading it** — sent in the last moments of a run — your message comes back
  to the field, to send again.

## Stopping and removing

`x` twice stops a working subagent, and first tells the main agent you stopped it on purpose — told
nothing, it read the stop as a failure and launched the subagent again. `x` on a finished subagent
removes it from the list, `X` removes every finished one; the sessions stay in OpenCode, and one that
works again comes back. "Clear finished subagents" and "Show removed subagents again" are in the
command palette.

## Background subagents

By default the main agent launches a subagent and waits for it. Launched in the background, it
answers you straight away, keeps working, and is told when each subagent finishes. Cockpit asks the
main agent to do that for independent work, whenever its tool offers it:

| OpenCode | Background subagents |
| --- | --- |
| 2 | Built in. |
| 1 | Only when OpenCode starts with `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true`. A plugin cannot set it for you (measured). |

```sh
export OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true   # ~/.zshrc, then start OpenCode 1
```

`npx opencode-cockpit@latest doctor` warns when it is missing. Without it, the main agent is told not
to ask for the background, and to launch independent subagents in one message so they run side by
side.

One launched in the foreground can still be moved: `b` in the pane — or OpenCode's own `ctrl+b` in the
conversation — and the main agent carries on. It moves every subagent that conversation is waiting
on, under the same condition on OpenCode 1.

## Settings

In the `subagents` section of `~/.config/opencode-cockpit/config.json`, or a project's
`.cockpit.json` — read by both halves:

```jsonc
{ "subagents": { "sidebarRows": 6, "hideWhenEmpty": false, "hideFinishedAfterMinutes": 60 } }
```

| Setting | Default | |
| --- | --- | --- |
| `sidebarRows` | `6` | Subagents shown before the rest fold into a count, working ones first |
| `hideWhenEmpty` | `false` | With no subagents the block says `none yet` under its heading; `true` draws nothing |
| `hideFinishedAfterMinutes` | unset | Minutes a finished subagent stays in the sidebar; unset keeps it for the conversation |
| `hideNestedAfterSeconds` | `30` | Seconds a finished *nested* subagent — one a subagent launched — stays in the sidebar; a negative number keeps them |
| `keybinds` | `{ "cockpit.subagents.open": "<leader>d" }` | The key that opens the one working now |
| `guidance` | `true` | Tell the main agent about background subagents and follow-ups (agent side) |
| `enabled` | `true` | `false` switches both halves off; so does `features.subagents: false` |

Where the block sits is the top-level `"sidebar"` list's to say. The names from before 0.9 —
`hideFinishedAfter`, `hideNestedAfter`, `sidebarOrder` — are no longer read: the block shows a `!`
row naming the new one, and `/cockpit-setup` fixes it. See
[Configuration](/opencode-cockpit/configuration/).

## Known limits

- On OpenCode 2, `subagents_list` knows the subagents started since OpenCode did — a plugin there
  cannot list sessions. On OpenCode 1 it reads older ones too, with their history.
- Whether a round was yours or the main agent's is told apart by its text: the same words sent by
  both read as yours.

## See it without OpenCode

```sh
bunx @opencode-cockpit/subagents preview
```

Draws the sidebar block and the pane from a sample run, in your terminal. `--fixture <name>` draws
another conversation (`--help` lists them); `--fixture calls` draws every kind of call, with
`--columns` and `--state closed|open|whole`.
