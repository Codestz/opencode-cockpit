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
Subagents  3 · 2 running · 1 done
⠙ explore Map the authentication flow
    grep "session" src/auth/**      4s
⏸ general Fix the failing login test
    waiting for permission          2s
✓ general Update README for the new a…
    done · 3 tools                 28s
```

A subagent that launched its own has them indented under it. Working subagents are always shown;
finished ones fold into a count past `sidebarRows`. No subagents, no block.

## Full screen

Click a subagent — or press `ctrl+x w`, or run `/subagents` for the one working now — and it opens
over the conversation:

- **the task** the main agent gave it, at the top;
- **its thinking**, as it streams;
- **every tool call** — what it was about, and how long it took; the running one streams its
  output underneath;
- **its answer**, as it is written.

Long runs of finished calls fold into "N earlier calls"; `e` shows them. The screen follows the run
as it grows; scroll up and it stays where you put it until `G`.

| Key | |
| --- | --- |
| `←` `→` | Another subagent of this conversation |
| `m` | Message it |
| `t` | Show or hide its thinking |
| `e` | Show every call |
| `j` `k` · `g` `G` | Scroll · to the start · follow the run |
| `esc` `q` | Back to the conversation |

## Messaging a subagent

Press `m` and write. Measured on both OpenCodes:

- **While it works**, it picks the message up in its current run, acts on it, and says so in its
  answer — which the main agent receives, so it learns of it too.
- **Once it has finished**, it wakes up and answers you, but **the main agent is not told** — its
  task already returned. The screen says so under the keys.

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
| `sidebarOrder` | `160` | Where the block sits among sidebar blocks; lower draws first |
| `keybinds` | `{ "cockpit.subagents.open": "<leader>w" }` | The key that opens one full screen |
| `guidance` | `true` | Ask the agent to use background subagents (agent side) |

Switch the whole bay off in the bundle with `{ "features": { "subagents": false } }`.

## See it without OpenCode

```sh
bunx @opencode-cockpit/subagents preview
```

Draws the sidebar block and the full screen from a sample run, in your terminal.
