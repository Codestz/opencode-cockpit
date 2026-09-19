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
opencode plugin @opencode-cockpit/shell --global
```

## Statusline — available

A line of live session state under the conversation, or a column of it in the sidebar. Fourteen
segments, two surfaces, and three ways to configure it — including running the statusline script you
already wrote for Claude Code, colours and all. See
[Statusline](/opencode-cockpit/status/overview/).

```sh
opencode plugin @opencode-cockpit/status --global
```

## Agents — next

OpenCode can run subagents, but watching one means clicking into a panel that replaces your
conversation. The plan: a live tree in the sidebar, a peek overlay that keeps your place, keyboard
navigation, per-agent output, and cost rolled up per run.

## The open bay

Nothing started, ideas on the table: checkpoints, a context and cost meter, ports and services,
scheduled prompts, shared memory between sessions.
[Open an issue](https://github.com/Codestz/opencode-cockpit/issues) and make the case.

## Installing one, or all

The bundle installs every bay with a switch each; a single package installs exactly one. Both use
the same daemon, config file and interface slots, so moving between them changes nothing you have
already set up.
