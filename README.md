# opencode-cockpit

[![CI](https://github.com/Codestz/opencode-cockpit/actions/workflows/ci.yml/badge.svg)](https://github.com/Codestz/opencode-cockpit/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/opencode-cockpit)](https://www.npmjs.com/package/opencode-cockpit)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Superpowers for [OpenCode](https://opencode.ai). Take all of them, or only the ones you want.

| Feature | What it gives you | Package |
|---|---|---|
| **Shell** | Background terminals the agent starts, waits on and drives, with a docked panel and console for you | [`@opencode-cockpit/shell`](packages/shell) |
| **Agents** *(coming)* | A live, keyboard-first view of every subagent, without leaving your chat | `@opencode-cockpit/agents` |

## Install

**Everything**

```sh
opencode plugin opencode-cockpit --global
```

**Only what you want**

```sh
opencode plugin @opencode-cockpit/shell --global
```

**Everything except some features**: switch them off on the plugin entry, in both `opencode.json`
and `tui.json`:

```json
{ "plugin": [["opencode-cockpit", { "features": { "shell": false } }]] }
```

Restart OpenCode after installing. Requires OpenCode 1.18 or newer on macOS or Linux.

> Install a feature **either** through `opencode-cockpit` **or** on its own, not both. If both are
> configured, the first one loaded is used and OpenCode shows a warning telling you which entry to
> remove.

## Configuring features

Each feature's README lists its options. With `opencode-cockpit`, nest them under the feature's
name:

```json
{
  "plugin": [
    ["opencode-cockpit", { "shell": { "dockHeight": 16, "historyMinutes": 60 } }]
  ]
}
```

With a standalone package, put them directly on its entry:
`["@opencode-cockpit/shell", { "dockHeight": 16 }]`.

## How it works

```
OpenCode TUI thread ── feature plugins (tui) ──┐
                                                ├── unix socket, JSON-RPC ── cockpitd ── processes
OpenCode server worker ─ feature plugins (server) ┘
```

Each feature is a complete OpenCode plugin. Features that need long-lived processes share one
small daemon, `cockpitd`, which starts on demand, is shared by every OpenCode window, upgrades
itself when a newer plugin connects and exits when idle. See [CONTRIBUTING.md](CONTRIBUTING.md).

| Package | Role |
|---|---|
| [`opencode-cockpit`](packages/opencode) | All features in one plugin, each can be switched off |
| [`@opencode-cockpit/shell`](packages/shell) | Shell feature |
| [`@opencode-cockpit/daemon`](packages/daemon) | `cockpitd`, the shared process host |
| [`@opencode-cockpit/client`](packages/client) | Typed, auto-spawning client and shared plugin helpers |
| [`@opencode-cockpit/protocol`](packages/protocol) | Wire contracts |

## Roadmap

- **Watchers** (Shell): `tsc`, `eslint` and `vitest` shells that report only state changes.
- **Agents**: live subagent tree with a peek overlay.
- **Doctor**: one command that checks your setup (duplicate features, daemon health, config) and
  tells you how to fix it.
- Coloured output in the Shell panel and console.

## License

[MIT](LICENSE)
