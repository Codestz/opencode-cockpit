# @opencode-cockpit/subagents

**See what your subagents are doing, while they do it — and reuse them.** When the main agent hands
work to a subagent, you get one line in the chat and nothing else. This puts every subagent in the
sidebar with what it is doing right now, opens its whole run in a pane — thinking, every tool call as
OpenCode draws its own, the answer — lets you message it, stop it or move it to the background, and
has the main agent continue the subagent that did the work instead of starting from nothing.

Part of [opencode-cockpit](https://github.com/Codestz/opencode-cockpit). Install it on its own, or
through the bundle. Works on OpenCode 1.18+ and 2.0.15+.

```sh
opencode plugin @opencode-cockpit/subagents@0.7.1 --global --force     # OpenCode 1
opencode plugin add @opencode-cockpit/subagents@0.7.1                   # OpenCode 2
```

## What it does

**In the sidebar**, a Subagents block: each subagent in this conversation, its type and task, and
under it what it is doing now — `grep "session" src/auth/**`, `thinking`, `waiting for permission`,
`done · 2 rounds`, `cancelled` — with how many calls and how long on the right. A subagent that
launched its own has them indented under it.

**Click one** — or `ctrl+x w`, or `/subagents` — and its run opens in a pane on the right, half the
window or all of it: its model and who launched it, the task, then the run. A shell command or a file
change is a box with its output (ten lines, sixty open, all with `a`); reads and searches are one quiet
line each; thinking folds; the answer is drawn as markdown.

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

**Follow-ups keep their context.** The main agent is asked to continue the subagent that did the work
(`task_id` on OpenCode 1, `sessionID` on 2) rather than launch a new one, and has a `subagents_list`
tool: each subagent's id, task, state and last answer — saying when one was cancelled, or ended on a
progress note rather than an answer. Each round shows in the pane under a "Round N" rule.

**Message it.** A subagent that is still working picks your message up in its current run and answers
it in its report, so the main agent sees it too. A finished one wakes up and answers you, and Cockpit
adds the exchange to the main conversation without starting a turn there, so the main agent knows it
next time. A message it finished without reading comes back to the field.

**Stop and remove.** `x` twice stops a working subagent — and first tells the main agent you stopped
it on purpose, so it reports the stop instead of launching the subagent again. `x` on a finished one
removes it from the list, `X` removes every finished one; the sessions stay in OpenCode.

**Background subagents.** The main agent is asked to launch independent subagents with
`background: true` when its tool offers it, so the conversation keeps going. OpenCode 2 offers it
always; **OpenCode 1 only when started with `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true`** — a
plugin cannot set that for you. `b` moves one already running in the foreground, the same way.

```sh
export OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true   # in ~/.zshrc, then start OpenCode
```

## Settings

In the bundle's entry (`"subagents": { … }`) or this package's own:

| Setting | Default | |
| --- | --- | --- |
| `sidebarRows` | `6` | Subagents shown before the rest fold into a count — working ones first |
| `hideFinishedAfter` | unset | Minutes a finished subagent stays in the sidebar; unset keeps it for the conversation |
| `sidebarOrder` | `150` | Where the block sits in the sidebar; lower draws first |
| `keybinds` | `{ "cockpit.subagents.open": "<leader>w" }` | The key that opens the latest one |
| `guidance` | `true` | Tell the main agent about background subagents and follow-ups (agent side) |

## See it without OpenCode

```sh
bunx @opencode-cockpit/subagents preview
```

Draws the sidebar block and the pane from a sample run, in your terminal.

## Troubleshooting

```sh
npx opencode-cockpit@latest doctor
```

checks OpenCode, its config, Cockpit's logs and the daemon, and prints the fix for anything wrong —
on OpenCode 1 and 2, and when Cockpit will not load at all ([what it checks](https://codestz.github.io/opencode-cockpit/help/doctor/)).

Everything Cockpit does inside OpenCode goes to one file — which OpenCode loaded which bay, and every
error with its stack:

```sh
tail -50 ~/.cache/opencode-cockpit/cockpit.log
```

`COCKPIT_DEBUG=1 opencode` adds the detail. [Troubleshooting](https://codestz.github.io/opencode-cockpit/help/troubleshooting/) covers
the failures people hit and what to attach to an issue; [OpenCode 1 and 2](https://codestz.github.io/opencode-cockpit/start/opencode-versions/)
covers what differs between the two.
