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
opencode plugin @opencode-cockpit/shell@0.4.3 --global --force
```

## Statusline — available

A line of live session state under the conversation, or a column of it in the sidebar. Fourteen
segments, two surfaces, and three ways to configure it — including running the statusline script you
already wrote for Claude Code, colours and all. See
[Statusline](/opencode-cockpit/status/overview/).

```sh
opencode plugin @opencode-cockpit/status@0.4.3 --global --force
```

## Review — available

A pull request in the terminal: the diff where the work happened, comments on the lines they are
about, and an agent that can read them, answer them and mark them resolved. A resolve is checked
against the file before it counts. See [Review](/opencode-cockpit/review/overview/).

```sh
opencode plugin @opencode-cockpit/review@0.4.3 --global --force
```

## Updater — available

Every plugin you have installed — not just this one — with what is really running beside what your
config says and what is published. An update pins an exact version through OpenCode's own
`opencode plugin`, removes the stale cache and reads every file back, because OpenCode resolves a
spec once and `@latest` never moves again. From a shell, on any version:
`npx opencode-cockpit@latest update`. See [Updater](/opencode-cockpit/updater/overview/).

```sh
opencode plugin @opencode-cockpit/updater@0.4.3 --global --force
```

## Doctor — next

One command that checks your setup and says how to fix it.

## The open bay

Nothing started, ideas on the table: checkpoints, ports and services, scheduled prompts, shared
memory between sessions. [Open an issue](https://github.com/Codestz/opencode-cockpit/issues) and
make the case.


## Installing one, or all

The bundle installs every bay with a switch each; a single package installs exactly one. Both use
the same daemon, config file and interface slots, so moving between them changes nothing you have
already set up.
