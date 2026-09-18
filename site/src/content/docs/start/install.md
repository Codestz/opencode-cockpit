---
title: Install
description: Two commands, both config files, and what happens on first run.
---

Requires **OpenCode 1.18+** on macOS or Linux.

## Everything

```sh
opencode plugin opencode-cockpit --global
```

This writes the plugin entry into **both** `opencode.json` and `tui.json` — the agent half and the
interface half. Restart OpenCode afterwards.

## A single bay

```sh
opencode plugin @opencode-cockpit/shell --global
```

Same daemon, same config file, same interface slots. Add other bays later without changing anything
you already set up.

:::caution[Don't install both]
If a bay is configured twice — once through the bundle and once on its own — the first one loaded
wins and Cockpit warns you which entry to remove.
:::

## Turning bays off

```json title="opencode.json and tui.json"
{
  "plugin": [
    ["opencode-cockpit", { "features": { "shell": true } }]
  ]
}
```

## What happens on first run

1. The plugin connects to `cockpitd`, starting it if it isn't running.
2. The daemon creates `~/.cache/opencode-cockpit/` for its socket, logs and process registry.
3. It exits again after ten idle minutes with no clients and no running shells.

Shells survive an OpenCode restart, and a second OpenCode window sees the same ones.

## Staying up to date

OpenCode resolves an unpinned plugin spec **once** and caches it forever, so `@latest` does not move
on its own. Cockpit checks the registry at most once a day and offers `/cockpit-update`, which clears
the cache entry so the next start installs the new version.
