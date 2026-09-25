# @opencode-cockpit/subagents

**See what your subagents are doing, while they do it.** When the main agent hands work to a
subagent, you get one line in the chat and nothing else. This puts every subagent in the sidebar with
what it is doing right now, opens any of them full screen — its thinking, every tool call, the answer
it is writing — and lets you message it directly.

Part of [opencode-cockpit](https://github.com/Codestz/opencode-cockpit). Install it on its own, or
through the bundle. Works on OpenCode 1.18+ and 2.0.15+.

```sh
opencode plugin @opencode-cockpit/subagents@0.6.0 --global --force     # OpenCode 1
opencode plugin add @opencode-cockpit/subagents@0.6.0                   # OpenCode 2
```

## What it does

**In the sidebar**, a Subagents block: each subagent in this conversation, its type and task, and
under it what it is doing now — `grep "session" src/auth/**  51s`, `thinking`, `waiting for
permission`, `done`, with how many calls and how long on the right. A subagent that launched its own has them indented under it.

**Click one** — or `ctrl+x w`, or `/subagents` — and it opens in a pane on the right, half the
window or all of it: its model and who launched it, the task it was given, then its run. Every tool
call is one line — name, target, result (`9 matches`) and time when it took one — and opens to its
arguments and output, the way OpenCode draws its own; the running one is open, streaming. Thinking
folds to one line. The answer is drawn as markdown, and your messages sit in the run as cards.

| Key | |
| --- | --- |
| `j` `k` | Move the cursor through the run's items |
| `enter` · a click | Open or fold the item under it |
| `e` | Open, or fold, every call |
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

**Message it.** A subagent that is still working picks your message up in its current run and
answers it in its report, so the main agent sees it too. A finished one wakes up and answers you —
but the main agent is not told; the screen says so under the keys.

**Stop and remove.** `x` twice stops a working subagent — and first tells the main agent you stopped it
on purpose, so it reports the stop instead of launching the subagent again.
`x` on a finished subagent removes it from the list, `X` removes every finished one — the sessions
stay in OpenCode, and one that works again comes back. "Clear finished subagents" and "Show removed
subagents again" are in the command palette.

**Background subagents.** The main agent is asked to launch independent subagents with
`background: true` when its tool offers it, so the conversation keeps going while they work and it
is told as each one finishes. OpenCode 2 offers it always; **OpenCode 1 only when started with
`OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true`** — a plugin cannot set that for you:

```sh
export OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true   # in ~/.zshrc, then start OpenCode
```

## Settings

In the bundle's entry (`"subagents": { … }`) or this package's own:

| Setting | Default | |
| --- | --- | --- |
| `sidebarRows` | `6` | Subagents shown before the rest fold into a count — working ones first |
| `sidebarOrder` | `150` | Where the block sits in the sidebar; lower draws first |
| `keybinds` | `{ "cockpit.subagents.open": "<leader>w" }` | The key that opens the latest one |
| `guidance` | `true` | Tell the agent about background subagents (agent side) |

## See it without OpenCode

```sh
bunx @opencode-cockpit/subagents preview
```

Draws the sidebar block and the full screen from a sample run, in your terminal.

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
