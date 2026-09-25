---
title: Subagents
description: Every subagent in the sidebar with what it is doing now, its whole run a click away, and follow-ups that keep its context.
---

When the main agent hands work to a subagent, OpenCode shows one line in the chat — "General
Subagent — Fix the login test" — and nothing about what it is doing. Subagents makes them visible,
reachable and reusable, on OpenCode 1 and 2 alike.

```sh
opencode plugin @opencode-cockpit/subagents@0.6.0 --global --force     # OpenCode 1
opencode plugin add @opencode-cockpit/subagents@0.6.0                   # OpenCode 2
```

Or through the bundle, where it is on by default.

## In the sidebar

A **Subagents** block: every subagent of the conversation you are in, its type and task, and under
it what it is doing now — with how many calls and how long on the right.

```
Subagents                  2 running
⠹ explore Map the authentication fl…
  └ grep "session" src… 4 calls · 4s
○ general Fix the failing login test
  └ waiting for permis… 3 calls · 2s
● general Update README for the new…
  └ done · 2 rounds    3 calls · 28s
```

A spinner is working, `○` waits on a permission, a green `●` finished, an amber `cancelled` was
stopped. A subagent that launched its own has them indented under it. Working subagents are always
shown; finished ones fold into a count past `sidebarRows`, and leave after `hideFinishedAfter`
minutes if you set it. No subagents, no block.

The sidebar reads statusline, subagents, shells, top to bottom — `"sidebar"` in
[Cockpit's config](/configuration/) reorders it.

## The pane

Click a subagent — or press `ctrl+x w`, or run `/subagents` for the one working now — and its run
opens in a pane on the right: half the window, or all of it with `w`. A click outside closes it.

Under its name: the model, whether it runs in the background, who launched it, and its calls, steps
and tokens so far. Then the run, the way OpenCode draws its own:

- **the task** the main agent gave it, as a card at the top;
- **its thinking** — "Thought · 1.2s" and the words, folded to one line with `t`;
- **a shell command or a file change** as a box: the command, then its output — ten lines folded,
  sixty open, all of it with `a` — and "Click to expand" when there is more; red when it failed;
- **reads, searches and fetches** as one quiet line each — `→ Read src/auth/session.ts`,
  `✱ Grep "session"  9 matches` — that open into a box of their arguments and output;
- **its answer**, drawn as markdown as it is written.

Every item is selectable: `j` `k` move the cursor, `enter` or a click opens or folds. The pane follows
the run as it grows; scroll or move the cursor and it stays where you put it until `G`.

| Key | |
| --- | --- |
| `j` `k` | Move the cursor through the run's items |
| `enter` · a click | Open or fold the item under it |
| `e` | Open, or fold, every call |
| `a` | A call's whole output — open shows its first 60 lines, whole up to 2,000 |
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
OpenCode 2's `sessionID` — rather than launch a new one, and gives it a `subagents_list` tool: each
subagent's id, task, state and last answer, for when the id has scrolled out of its context. The list
says when a subagent was cancelled, and when it ended on a progress note rather than an answer.

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

One launched in the foreground can still be moved: `b` in the pane — or OpenCode's own `ctrl+b` in the
conversation — and the main agent carries on. It moves every subagent that conversation is waiting
on, under the same condition on OpenCode 1.

## Settings

In the bundle's entry (`"subagents": { … }`) or this package's own:

| Setting | Default | |
| --- | --- | --- |
| `sidebarRows` | `6` | Subagents shown before the rest fold into a count, working ones first |
| `hideFinishedAfter` | unset | Minutes a finished subagent stays in the sidebar; unset keeps it for the conversation |
| `sidebarOrder` | `150` | Where the block sits among sidebar blocks; lower draws first |
| `keybinds` | `{ "cockpit.subagents.open": "<leader>w" }` | The key that opens the one working now |
| `guidance` | `true` | Tell the main agent about background subagents and follow-ups (agent side) |

Switch the whole bay off in the bundle with `{ "features": { "subagents": false } }`.

## Known limits

- On OpenCode 2, `subagents_list` knows the subagents started since OpenCode did — a plugin there
  cannot list sessions. On OpenCode 1 it reads older ones too, with their history.
- Whether a round was yours or the main agent's is told apart by its text: the same words sent by
  both read as yours.

## See it without OpenCode

```sh
bunx @opencode-cockpit/subagents preview
```

Draws the sidebar block and the pane from a sample run, in your terminal.
