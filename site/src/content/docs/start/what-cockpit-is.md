---
title: What Cockpit is
description: A platform for OpenCode capabilities — one daemon, one config, one place in the interface.
---

Cockpit is the airframe. Capabilities bolt into it as **bays**; today there is one fitted, **Shell**,
which gives your agent background terminals.

The platform exists because every capability of this kind hits the same three problems, and solving
them once is the whole point.

## A daemon that outlives the session

OpenCode runs its interface and its server in **separate threads that cannot share memory**, and
neither survives a restart. Anything long-lived — a process, a watcher, a subscription — has nowhere
to live.

`cockpitd` is that home. It starts on demand, is shared by every OpenCode window on the machine,
replaces itself when newer plugin code connects, reaps whatever a crash left behind, and exits when
nothing needs it.

## One config for both halves

Agent plugins are configured in `opencode.json`, interface plugins in `tui.json`. Without help, every
setting has to be written twice.

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
