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
permission`, `done · 3 tools`. A subagent that launched its own has them indented under it.

**Click one** — or `ctrl+x w`, or `/subagents` — and it opens full screen: the task it was given,
its thinking as it streams, every tool call with what it was about and how long it took (the running
one streams its output), and the answer as it is written. Long runs of finished calls fold.

| Key | |
| --- | --- |
| `←` `→` | Another subagent |
| `m` | Message it |
| `t` | Show or hide its thinking |
| `e` | Show every call |
| `j` `k` | Scroll — `g` to the start, `G` to follow the run |
| `esc` `q` | Back |

**Message it.** A subagent that is still working picks your message up in its current run and
answers it in its report, so the main agent sees it too. A finished one wakes up and answers you —
but the main agent is not told; the screen says so under the keys.

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
| `sidebarOrder` | `160` | Where the block sits in the sidebar; lower draws first |
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
