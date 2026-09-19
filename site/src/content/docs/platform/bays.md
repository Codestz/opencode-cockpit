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

## Review — next

A turn ends and you read the whole diff at once, or you read none of it and hope.

GitHub solved the reading part years ago, and the shape transfers: comment on a line, comment on a
file, mark a file read so the next turn starts smaller, suggest the change rather than describing
it — and none of it reaches the author until you submit the review. Here the review goes to the
chat as one message instead of six interruptions, and a part you reject can be reverted on its own
rather than costing you the turn.

What it needs already exists: `session.diff` returns each file's `before` and `after` in full,
`session.revert` undoes a single message or part, and a plugin can write to the prompt. What is
missing is the view and the keys.

## Doctor — after that

One command that checks your setup and says how to fix it.

## The open bay

Nothing started, ideas on the table: checkpoints, ports and services, scheduled prompts, shared
memory between sessions. [Open an issue](https://github.com/Codestz/opencode-cockpit/issues) and
make the case.

Two ideas that were considered and dropped, so nobody spends time on them twice:

- **A live subagent tree.** OpenCode's own subagent view already does most of it; a second one
  would have been a different arrangement of the same information rather than a new capability.
- **Taking over the sidebar's Context block.** It is not a slot a plugin can contribute to and
  there is no setting for it, so hiding or replacing it is not possible from a plugin at all. It
  would need a change in OpenCode.

## Installing one, or all

The bundle installs every bay with a switch each; a single package installs exactly one. Both use
the same daemon, config file and interface slots, so moving between them changes nothing you have
already set up.
