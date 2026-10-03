---
title: Capability bays
description: What a bay is, what ships today, and what is next.
---

A bay is a capability: its own npm package, its own daemon module, its own slot in the interface, and
a switch in config. They share everything underneath.

## Shell — available

Background terminals with a real PTY. Nine agent tools, 35 watch presets, three views of every
shell, log search, limits and log files. See [Shell](/opencode-cockpit/shell/overview/).

```sh
opencode plugin @opencode-cockpit/shell@0.8.0 --global --force
```

## Statusline — available

A table of live session state in the sidebar, or a line of it under the conversation. Twenty-three
segments, two surfaces, and three ways to configure it — including running the statusline script you
already wrote for Claude Code, colours and all. See
[Statusline](/opencode-cockpit/status/overview/).

```sh
opencode plugin @opencode-cockpit/status@0.8.0 --global --force
```

## Review — available

A pull request in the terminal: the diff where the work happened, comments on the lines they are
about, and an agent that can read them, answer them and mark them resolved. A resolve is checked
against the file before it counts. See [Review](/opencode-cockpit/review/overview/).

```sh
opencode plugin @opencode-cockpit/review@0.8.0 --global --force
```

## Updater — available

Every plugin you have installed — not just this one — with what is really running beside what your
config says and what is published. An update pins an exact version through OpenCode's own
`opencode plugin`, removes the stale cache and reads every file back, because OpenCode resolves a
spec once and `@latest` never moves again. From a shell, on any version:
`npx opencode-cockpit@latest update`. See [Updater](/opencode-cockpit/updater/overview/).

```sh
opencode plugin @opencode-cockpit/updater@0.8.0 --global --force
```

## Subagents — available

Every subagent of the conversation in the sidebar with what it is doing now, its whole run a click
away in a pane, and a message away with `m`. Follow-ups continue the subagent that did the work
instead of starting a new one, and the main agent can list, read and wait on its subagents. See
[Subagents](/opencode-cockpit/subagents/overview/).

```sh
opencode plugin @opencode-cockpit/subagents@0.8.0 --global --force
```

## Trail — available

What a conversation made: the pull requests, tickets, pages and deploys the agent created or changed,
recorded by the agent with `trail_add`, kept per conversation, grouped by the ticket they were for,
and one click from the page. `/trail` says which conversation made what, across the project. No
setup. See [Trail](/opencode-cockpit/trail/overview/).

```sh
opencode plugin @opencode-cockpit/trail@0.8.0 --global --force
```

## Trust — available

Permissions that learn. Approve the exact same command three times in a row and Trust answers
OpenCode's prompt for you from then on, and records every answer; dangerous commands cost more,
and a rule you wrote to be asked is never answered. `/trust` shows what it has learned. See
[Trust](/opencode-cockpit/trust/overview/).

```sh
opencode plugin @opencode-cockpit/trust@0.8.0 --global --force
```

## Doctor — available

`npx opencode-cockpit@latest doctor` checks your setup on OpenCode 1 and 2 and prints the fix for
anything wrong, even when Cockpit will not load. See [Doctor](/opencode-cockpit/help/doctor/).

## The open bay

Nothing started, ideas on the table: checkpoints, ports and services, scheduled prompts, shared
memory between sessions. [Open an issue](https://github.com/Codestz/opencode-cockpit/issues) and
make the case.


## Installing one, or all

The bundle installs every bay with a switch each; a single package installs exactly one. Both use
the same daemon, config file and interface slots, so moving between them changes nothing you have
already set up.
