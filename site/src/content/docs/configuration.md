---
title: Configuration
description: One file for both halves of the plugin — every section, with examples.
---

Everything is optional. Settings are merged from three places, later winning key by key:

```
~/.config/opencode-cockpit/config.json   →   <project>/.cockpit.json   →   plugin-entry options
```

A project can override one setting without restating the rest, and an unreadable or invalid file is
**ignored rather than fatal** — a typo should never stop your shells from working. `XDG_CONFIG_HOME`
is honoured for the global path.

```json title="~/.config/opencode-cockpit/config.json"
{
  "kinds": { "e2e": "playwright|cypress", "infra": "^(terraform|pulumi)\\b" },
  "watch": {
    "auto": false,
    "presets": { "e2e": { "done": "\\d+ passed", "fail": "\\d+ failed" } }
  },
  "defaults": { "logFile": true, "timeoutSeconds": 900 },
  "notify": { "exit": true, "watch": true, "tailLines": 15 },
  "guidance": true,
  "listRunningShells": 15,
  "ui": { "dockHeight": 16, "dockOpen": true, "defaultView": "screen" }
}
```

## kinds

Extra shell categories, or overrides, as `name` → regular expression matched against the command.
They drive the badge in the panel and sidebar and the `kind` filter in `shell_list`, so you can
group your own stack instead of the built-ins (`server`, `tests`, `build`, `watcher`, `task`).

## watch

`presets` are your own rules, keyed by name, and they reach the daemon as explicit rules — so a
preset you invent works immediately. `auto` attaches a matching preset to every new shell; **off by
default**.

## defaults

Applied to every shell the agent starts unless the call says otherwise: `watch`, `logFile`,
`idleTimeoutSeconds`, `timeoutSeconds`, `notifyOnExit`.

## notify

What may interrupt the agent: `exit`, `watch`, and `tailLines` — how much output rides along with an
exit message.

## guidance and listRunningShells

The context budget. `guidance` is the paragraph that teaches the model when to reach for a shell
(~120 tokens per request); `listRunningShells` is how many running shells are named in the system
prompt each turn (~20 tokens each, `0` disables). Turning both off saves tokens at the cost of a
model that uses shells less well.

## ui

Interface only: `dockHeight`, `dockOpen`, `sidebarRows`, `historyMinutes`, `colors`, `defaultView`
(`screen` or `log`), `keybinds`, `updateCheck`.

:::tip[dockOpen decides how it starts]
Set it and the panel always starts that way. Leave it out and it starts however you last left it.
:::

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `COCKPIT_HOME` | `~/.cache/opencode-cockpit` | Socket, logs, process registry |
| `COCKPIT_IDLE_TIMEOUT_MS` | `600000` | Daemon exits after this long unused |
| `COCKPIT_LOG_LEVEL` | `info` | `debug` for verbose daemon logs |
