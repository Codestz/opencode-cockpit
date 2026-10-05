---
title: Install
description: Two commands, both config files, and what happens on first run.
---

Requires **OpenCode 1.18+ or 2.0.15+** on macOS or Linux — one package runs on both. Which version
you have, and what differs, is in [OpenCode 1 and 2](/start/opencode-versions/).

## Everything

On **OpenCode 1**:

```sh
opencode plugin opencode-cockpit@0.10.1 --global --force
```

This writes the plugin entry into **both** `opencode.json` and `tui.json` — the agent half and the
interface half.

On **OpenCode 2**:

```sh
opencode plugin add opencode-cockpit@0.10.1
```

This writes `"plugins"` in `opencode.json`, and OpenCode 2 loads both halves from there.

Restart OpenCode afterwards. **On OpenCode 2, restart its background service too**, after installing
and after every update:

```sh
opencode service restart
```

OpenCode 2 runs the agent side in a background service that loads plugins once, when it starts, and
keeps running when you close OpenCode. Until it restarts, the windows draw the new Cockpit while the
agent keeps the old one's tools and skills. A window says so when it sees it — one toast, `Cockpit was
updated — OpenCode's background service still runs the old one. Run: opencode service restart` — and
[doctor](/help/doctor/)'s Service check says the same from a terminal. Cockpit never
restarts the service for you: that would cut every open window.

## A single bay

```sh
opencode plugin @opencode-cockpit/shell@0.10.1 --global --force     # OpenCode 1
opencode plugin add @opencode-cockpit/shell@0.10.1                   # OpenCode 2
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
    { "package": "opencode-cockpit@0.10.1", "options": { "features": { "shell": true } } }
  ]
}
```

## Setting it up

Everything works with no configuration. To choose what shows, type `/cockpit-setup` — or just ask,
"make my sidebar quieter". The agent reads what is installed and set now, fixes any name from before
0.9, and writes `~/.config/opencode-cockpit/config.json` with you: which bays show, in the sidebar or
at the bottom, in what order, quiet or present when empty. Then, if you want, it tunes Cockpit to how
you work — see [Configuration](/configuration/#the-easy-way-cockpit-setup).

## What happens on first run

1. The plugin connects to `cockpitd`, starting it if it isn't running.
2. The daemon creates `~/.cache/opencode-cockpit/` for its socket, logs and process registry.
3. It exits again after ten idle minutes with no clients and no running shells.

Shells survive an OpenCode restart, and a second OpenCode window sees the same ones.

## Staying up to date

OpenCode resolves a plugin spec **once** and caches it for ever, so a bare `opencode-cockpit` or
`@latest` means the release that was newest the day you first installed it. That is why the commands
above pin a version, and why `--force` is there: run the same line with a newer version to move.

On OpenCode 2, change the version in your `opencode.json` entry, then run `opencode service restart`
— Cockpit's updater edits OpenCode 1's files only. On OpenCode 1 you rarely need to: once a day Cockpit checks every plugin you have — not just its own — and says so
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
