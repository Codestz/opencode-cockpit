---
title: Subagents
description: Every subagent in the sidebar with what it is doing now, any of them full screen, and a message away.
---

When the main agent hands work to a subagent, OpenCode shows one line in the chat — "General
Subagent — Fix the login test" — and nothing about what it is doing. Subagents makes them visible
and reachable, on OpenCode 1 and 2 alike.

```sh
opencode plugin @opencode-cockpit/subagents@0.6.0 --global --force     # OpenCode 1
opencode plugin add @opencode-cockpit/subagents@0.6.0                   # OpenCode 2
```

Or through the bundle, where it is on by default.

## In the sidebar

A **Subagents** block: every subagent of the conversation you are in, its type and task, and under
it what it is doing now.

```
Subagents                  2 running
⠹ explore Map the authentication fl…
  └ grep "session" src… 4 calls · 4s
○ general Fix the failing login test
  └ waiting for permis… 3 calls · 2s
● general Update README for the new…
  └ done               3 calls · 28s
```

A subagent that launched its own has them indented under it. Working subagents are always shown;
finished ones fold into a count past `sidebarRows`. No subagents, no block.

## The pane

Click a subagent — or press `ctrl+x w`, or run `/subagents` for the one working now — and it opens
in a pane on the right — half the window, or all of it with `w`. A click outside it closes it.
Under its name: the model, whether it runs in the background, who launched it, and its calls,
steps and tokens so far. Then:

- **the task** the main agent gave it, at the top;
- **its thinking**, as it streams;
- **every tool call** — what it was about, and how long it took; the running one streams its
  output underneath;
- **its answer**, as it is written.

Each call is one line — name, target, its result in a few words (`9 matches`, `exit 1`) and its
time when it took one — and opens to its arguments under a `│` gutter, then its output; the running
call is open while it streams. Thinking folds to one line. The answer is drawn as markdown. The pane
follows the run as it grows; scroll or move the cursor and it stays where you put it until `G`.

| Key | |
| --- | --- |
| `j` `k` | Move the cursor through the run's items |
| `enter` · a click | Open or fold the item under it |
| `e` | Open, or fold, every call |
| `a` | A call's whole output — open shows its first 60 lines, whole up to 2,000 |
| `t` | Show or hide thinking — shown by default, and remembered |
| `m` | Write it a message, at the foot of the pane |
| `x` | Stop it (press twice) — or, once it has finished, remove it from the list |
| `X` | Remove every finished subagent from the list |
| `b` | Move it to the background, so the main agent carries on (OpenCode's own `ctrl+b`) |
| `i` | Details: model, what it is denied, calls by tool, tokens, cost |
| `w` | Half the window, or all of it (remembered) |
| `[` `]` | Another subagent of this conversation |
| `d` `u` · `g` `G` | Page down · up · to the start · follow the run |
| `esc` `q` | Back to the conversation |

## Messaging a subagent

Press `m` and write at the foot of the pane; `enter` sends, `esc` lets it go. Your message joins the
run as a card, under a "Round 2" rule. Measured on both OpenCodes:

- **While it works**, it picks the message up in its current run, acts on it, and says so in its
  answer — which the main agent receives.
- **Once it has finished**, it wakes up and answers you. Cockpit then adds what you asked and what it
  answered to the main conversation, without starting a turn there — OpenCode 1 shows it as a message,
  OpenCode 2 as a "Subagent exchange" line — so the main agent knows the next time you talk to it.

## Follow-ups keep their context

Ask the main agent to fix or extend what a subagent did, and it is asked to continue that same
subagent (OpenCode 1's `task_id`, OpenCode 2's `sessionID`) rather than start a new one — it keeps
everything it already read. `subagents_list` gives the main agent each subagent's id, task and last
answer, for when the id has scrolled out of its context. A round the main agent started says
"build continued it" in the pane, and the sidebar counts rounds.

## Moving one to the background

A subagent launched in the foreground blocks the conversation until it finishes. `b` in the pane —
or OpenCode's own `ctrl+b` in the conversation — moves it to the background: the main agent carries
on and hears when it finishes. It moves every subagent that conversation is waiting on. OpenCode 2
does this always; OpenCode 1 only when started with `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true`.

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

The main agent can also follow up with a subagent it already launched — continuing the same one
instead of starting a new one — and is asked to.

## Settings

In the bundle's entry (`"subagents": { … }`) or this package's own:

| Setting | Default | |
| --- | --- | --- |
| `sidebarRows` | `6` | Subagents shown before the rest fold into a count, working ones first |
| `hideFinishedAfter` | unset | Minutes a finished subagent stays in the sidebar; unset keeps it for the conversation. `X` clears them by hand |
| `sidebarOrder` | `150` | Where the block sits among sidebar blocks; lower draws first |
| `keybinds` | `{ "cockpit.subagents.open": "<leader>w" }` | The key that opens one full screen |
| `guidance` | `true` | Ask the agent to use background subagents (agent side) |

Switch the whole bay off in the bundle with `{ "features": { "subagents": false } }`.

## See it without OpenCode

```sh
bunx @opencode-cockpit/subagents preview
```

Draws the sidebar block and the full screen from a sample run, in your terminal.
