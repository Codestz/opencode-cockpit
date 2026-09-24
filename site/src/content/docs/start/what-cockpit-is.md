---
title: What Cockpit is
description: Instruments for OpenCode — things your agent can use, and things that tell you what it is doing.
---

Your agent starts a dev server and the tool call blocks until you kill it. It backgrounds one
instead and loses the output. It runs the suite and pastes two thousand lines into a context window
whose size you are guessing at.

OpenCode is an excellent terminal agent flying without instruments. Cockpit is the panel.

## What is fitted today

| Bay | Your agent gains | You gain |
| --- | --- | --- |
| **[Shell](/opencode-cockpit/shell/overview/)** | Terminals that keep running — it starts them, waits for "ready", reads the part that matters | A live panel of every process, with health it reports itself |
| **[Statusline](/opencode-cockpit/status/overview/)** | — | The session at a glance: how full the context is, where the tokens went, what changed, how long |
| **[Review](/opencode-cockpit/review/overview/)** | Comments it can read, answer and resolve — a resolve is checked against the file | The diff where the work happened, with notes on the lines they are about |
| **[Updater](/opencode-cockpit/updater/overview/)** | — | Every plugin you have: what is really running, what is published, and an update checked against disk |

Each is its own npm package with a switch in config. Take the suite or a single bay; either way it
is the same daemon, the same config file and the same keys, so moving between them changes nothing
you have already set up.

**[Doctor](/opencode-cockpit/platform/bays/)** is next: one command that checks your setup and says
how to fix it.

## Why a platform and not two plugins

Because every capability of this kind hits the same three problems, and solving them once is what
makes the second bay cheap.

## A daemon that outlives the session

OpenCode runs its interface and its server in **separate threads that cannot share memory**, and
neither survives a restart. Anything long-lived — a process, a watcher, a subscription — has nowhere
to live.

`cockpitd` is that home. It starts on demand, is shared by every OpenCode window on the machine,
replaces itself when newer plugin code connects, reaps whatever a crash left behind, and exits when
nothing needs it.

## One config for both halves

On OpenCode 1, agent plugins are configured in `opencode.json` and interface plugins in `tui.json`.
Without help, every setting has to be written twice.

Cockpit reads **one file**, merging global → project → plugin entry, and hands the result to both
halves. See [Configuration](/opencode-cockpit/configuration/).

## Real estate in the interface

A docked panel under the conversation, a full-screen console, a sidebar section and a keymap
namespace. A bay asks for the slot it needs; the chrome, the theme and the keybind conventions come
with it.

## A typed wire between them

JSON-RPC over a private unix socket, with schemas shared by client and daemon and a version on the
protocol. A bay adds its own methods and events without any other bay knowing, and a version
mismatch is reported rather than guessed at.

## What that buys you

Install the bundle and switch bays on and off, or install a single bay — the daemon, the config file
and the interface slots are identical either way.

```json title="~/.config/opencode-cockpit/config.json"
{
  "defaults": { "logFile": true },
  "ui": { "dockOpen": true }
}
```

Next: [Install](/opencode-cockpit/start/install/).
