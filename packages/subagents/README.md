# @opencode-cockpit/subagents

**See what your subagents are doing, while they do it — and reuse them.** When the main agent hands
work to a subagent, you get one line in the chat and nothing else. This puts every subagent in the
sidebar with what it is doing right now, opens its whole run in a pane — thinking, every tool call as
OpenCode draws its own, the answer — lets you message it, stop it or move it to the background, and
has the main agent continue the subagent that did the work instead of starting from nothing.

<img src="https://raw.githubusercontent.com/Codestz/opencode-cockpit/main/media/subagents.gif" width="760" alt="A subagent's pane: its task, the files it touched, a failed command and its thinking, while it works">

*Drawn by the bay's own renderer — the same code that runs in your terminal.*

Part of [opencode-cockpit](https://github.com/Codestz/opencode-cockpit). Install it on its own, or
through the bundle. Works on OpenCode 1.18+ and 2.0.15+.

```sh
opencode plugin @opencode-cockpit/subagents@0.10.2 --global --force     # OpenCode 1
opencode plugin add @opencode-cockpit/subagents@0.10.2                   # OpenCode 2
```

## What it does

**In the sidebar**, a Subagents block: each subagent in this conversation, its agent, muted, and its
task — a run with no title is named by its task's first words. The agents are one column, as wide as
the longest shown and eight cells at most, so `general`, `explore` and `build` read whole and the
titles line up. Under one still at it, what it is doing now: `grep "session" src/auth/**`,
`thinking`, `waiting for permission` — with how many calls and how long the run has taken on the
right. Working ones come first. A finished one is a single quiet row that says how long it ran
(`● general Update README for the… 28s`); its calls and rounds are in the pane. One held on a
permission is drawn in the warning tone and counted apart in the heading (`1 running · 1 needs you`).
A subagent that launched its own has them indented under it, and the same helper launched again and
again for the same task is one entry with a count (`×6`). A finished nested one leaves the sidebar
after `hideNestedAfterSeconds`; the heading still counts it. With none yet, the block still shows
its heading and `none yet`, so you can tell it is there.

**Click one** — or `ctrl+x d`, or `/subagents` — and its run opens in a pane on the right, half the
window or all of it: its model and who launched it, the task, then the run. A shell command or a file
change is a box with its output (ten lines, sixty open, all with `a`); reads and searches are one quiet
line each; a task names the subagent it launched, todos are a checklist, and an MCP tool is titled
`server · tool`. A call's arguments climb the same ladder as its output — three rows folded, sixty
open, up to two thousand with `a` — and a long one is drawn as markdown. Thinking folds and is drawn as
markdown too; the answer is markdown.

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
| `[` `]` · `←` `→` | Another subagent of this conversation |
| `d` `u` · `g` `G` | Page down · up · to the start · follow the run |
| `?` | Every key, in the pane — the footer has room for the ones you use constantly |
| `esc` `q` | Let go of the cursor, then back to the conversation |

**Follow-ups keep their context.** The main agent is asked to continue the subagent that did the work
(`task_id` on OpenCode 1, `sessionID` on 2) rather than launch a new one. Each round shows in the
pane under a "Round N" rule. The main agent has three tools of its own:

| Tool | What it answers |
| --- | --- |
| `subagents_list` | Each subagent's id, task, state — with when it ended, by the clock — and last answer; says when one was cancelled, or ended on a progress note rather than an answer |
| `subagents_read id [after]` | One subagent in full: why it stopped, its task, its whole final answer, and every call it made with what it was about and how it ended — paged with a cursor. Works on cancelled ones, which can be continued |
| `subagents_wait [ids] [any] [timeoutSeconds]` | Blocks until background subagents finish, fail, are cancelled or stop on a permission — never longer than its timeout — and returns each one's state and answer |

**Message it.** A subagent that is still working picks your message up in its current run and answers
it in its report, so the main agent sees it too. A finished one wakes up and answers you, and Cockpit
adds the exchange to the main conversation without starting a turn there, so the main agent knows it
next time. A message it finished without reading comes back to the field.

**Stop and remove.** `x` twice stops a working subagent — and first tells the main agent you stopped
it on purpose, so it reports the stop instead of launching the subagent again. `x` on a finished one
removes it from the list, `X` removes every finished one; the sessions stay in OpenCode.

**Background subagents.** Where the tool offers it, the main agent is asked to launch independent
subagents with `background: true`, so the conversation keeps going. OpenCode 2 offers it always;
**OpenCode 1 only when started with `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true`** — a plugin
cannot set that for you, and `opencode-cockpit doctor` says when it is missing. Without it the agent
is told not to try, and to launch independent subagents in one message so they run side by side.
`b` moves one already running in the foreground, the same way.

```sh
export OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true   # in ~/.zshrc, then start OpenCode
```

## Settings

In the `subagents` section of Cockpit's config file — read by both halves, in every project:

```
~/.config/opencode-cockpit/config.json   →   <project>/.cockpit.json   →   plugin-entry options
```

```jsonc
{ "subagents": { "sidebarRows": 6, "hideWhenEmpty": false, "hideFinishedAfterMinutes": 60 } }
```

The same keys also work on the plugin entry (the bundle's `"subagents": { … }`, or this package's
own), which wins over both files.

| Setting | Default | |
| --- | --- | --- |
| `sidebarRows` | `6` | Subagents shown before the rest fold into a count — working ones first |
| `hideWhenEmpty` | `false` | With no subagents the block says `none yet` under its heading; `true` draws nothing instead |
| `hideFinishedAfterMinutes` | unset | Minutes a finished subagent stays in the sidebar; unset keeps it for the conversation |
| `hideNestedAfterSeconds` | `30` | Seconds a finished *nested* subagent — one a subagent launched — stays in the sidebar; a negative number keeps them. The heading still counts them and `[` `]` still reach them |
| `keybinds` | `{ "cockpit.subagents.open": "<leader>d" }` | The key that opens the latest one |
| `guidance` | `true` | Tell the main agent about background subagents and follow-ups (agent side) |
| `enabled` | `true` | `false` switches both halves off |

Where the block sits is the top-level `"sidebar"` list's to say (`["status", "subagents", "shell",
"trail", "trust"]` by default). The names from before 0.9 — `hideFinishedAfter`, `hideNestedAfter`,
`sidebarOrder` — are not read; `/cockpit-setup` names them and fixes them.

## See it without OpenCode

```sh
bunx @opencode-cockpit/subagents preview
```

Draws the sidebar block and the pane from a sample run, in your terminal. `--fixture <name>` draws
another conversation (`--help` lists them); `--fixture calls` draws every kind of call, with
`--columns` and `--state closed|open|whole`.

## Troubleshooting

```sh
npx opencode-cockpit@latest doctor
```

checks OpenCode, its config, Cockpit's logs and the daemon, and prints the fix for anything wrong —
on OpenCode 1 and 2, and when Cockpit will not load at all ([what it checks](https://cockpit.codestz.dev/help/doctor/)).

Everything Cockpit does inside OpenCode goes to one file — which OpenCode loaded which bay, and every
error with its stack:

```sh
tail -50 ~/.cache/opencode-cockpit/cockpit.log
```

`COCKPIT_DEBUG=1 opencode` adds the detail. [Troubleshooting](https://cockpit.codestz.dev/help/troubleshooting/) covers
the failures people hit and what to attach to an issue; [OpenCode 1 and 2](https://cockpit.codestz.dev/start/opencode-versions/)
covers what differs between the two.
