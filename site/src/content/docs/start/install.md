---
title: Install
description: Two commands, both config files, and what happens on first run.
---

Requires **OpenCode 1.18+ or 2.0.15+** on macOS or Linux — one package runs on both. Which version
you have, and what differs, is in [OpenCode 1 and 2](/opencode-cockpit/start/opencode-versions/).

## Everything

On **OpenCode 1**:

```sh
opencode plugin opencode-cockpit@0.5.2 --global --force
```

This writes the plugin entry into **both** `opencode.json` and `tui.json` — the agent half and the
interface half.

On **OpenCode 2**:

```sh
opencode plugin add opencode-cockpit@0.5.2
```

This writes `"plugins"` in `opencode.json`, and OpenCode 2 loads both halves from there.

Restart OpenCode afterwards.

## A single bay

```sh
opencode plugin @opencode-cockpit/shell@0.5.2 --global --force     # OpenCode 1
opencode plugin add @opencode-cockpit/shell@0.5.2                   # OpenCode 2
```

Same daemon, same config file, same interface slots. Add other bays later without changing anything
you already set up.

:::caution[Don't install both]
If a bay is configured twice — once through the bundle and once on its own — the first one loaded
wins and Cockpit warns you which entry to remove.
:::

## Turning bays off

```json title="OpenCode 1 — opencode.json and tui.json"
{
  "plugin": [
    ["opencode-cockpit", { "features": { "shell": true } }]
  ]
}
```

```json title="OpenCode 2 — opencode.json"
{
  "plugins": [
    { "package": "opencode-cockpit@0.5.2", "options": { "features": { "shell": true } } }
  ]
}
```

## What happens on first run

1. The plugin connects to `cockpitd`, starting it if it isn't running.
2. The daemon creates `~/.cache/opencode-cockpit/` for its socket, logs and process registry.
3. It exits again after ten idle minutes with no clients and no running shells.

Shells survive an OpenCode restart, and a second OpenCode window sees the same ones.

## Staying up to date

OpenCode resolves a plugin spec **once** and caches it for ever, so a bare `opencode-cockpit` or
`@latest` means the release that was newest the day you first installed it. That is why the commands
above pin a version, and why `--force` is there: run the same line with a newer version to move.

On OpenCode 2, change the version in your `opencode.json` entry — Cockpit's updater edits OpenCode 1's
files only. On OpenCode 1 you rarely need to: once a day Cockpit checks every plugin you have — not just its own — and says so
when something is behind. `/plugins-update` shows what runs beside what your config says and what is
published, and updates what you pick: it pins the new version through OpenCode's own `opencode plugin`,
removes the stale cache, and reads every file back before calling it done.

:::tip[Stuck on an old version?]
An old copy cannot update itself — it predates the fix. This runs from npm instead, so it works
whatever you have installed:

```sh
npx opencode-cockpit@latest update     # or bunx
```
:::
