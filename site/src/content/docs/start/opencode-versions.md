---
title: OpenCode 1 and 2
description: Which Cockpit runs on which OpenCode, what moving to OpenCode 2 changes, and what it can't do there yet.
---

OpenCode 2 replaced the plugin API: a plugin written for OpenCode 1 does not run on it. From **0.6.0**,
Cockpit ships **one package for both** — each entry carries a v1 half and a v2 half, and whichever OpenCode loads it
picks its own. Nothing to choose at install time.

## Which Cockpit for which OpenCode

| Your OpenCode | Cockpit | |
| --- | --- | --- |
| 2.0.15 or newer | **0.6.0 or newer** | everything, with the [differences below](#what-differs-on-opencode-2) |
| 1.18.x | **0.6.0 or newer** | everything — tested on 1.18.0, 1.18.28 and 1.18.32 |
| older than 1.18 | not supported | upgrade OpenCode — 1.17 loads the panels but never draws full screen |

`opencode --version` says which you have.

## Installing on OpenCode 2

```sh
opencode plugin add opencode-cockpit@0.7.1
```

That writes `"plugins"` in `opencode.json`, and OpenCode 2 loads **both halves** from there — the agent
tools and the interface. A single bay works the same way:

```sh
opencode plugin add @opencode-cockpit/shell@0.7.1
```

Options go in the entry as an object — the v2 spelling of v1's `[name, options]` pair:

```json title="~/.config/opencode/opencode.json"
{
  "plugins": [
    { "package": "opencode-cockpit@0.7.1", "options": { "features": { "status": false } } }
  ]
}
```

## Moving from OpenCode 1 to 2

Nothing to change. OpenCode 2 reads an existing v1 `opencode.json` — `"plugin"` and all — and copies a
global `tui.json` into its own `cli.json` on first start. Cockpit's own settings
(`~/.config/opencode-cockpit/config.json`, `.cockpit.json`) and your statusline modules are the same
files on both.

What does not carry over is **Cockpit before 0.6**: it runs on OpenCode 1 only. If OpenCode 2 lists
Cockpit under `/plugins` as failed, change the version in your `opencode.json` entry to the newest
release and restart. Edit that entry rather than running `opencode plugin add` beside it — `add`
writes a second one and leaves the old.

## Running both side by side

The two can share one machine and one config. Install OpenCode 1 under another name (it is the
`opencode-ai` package on npm), and point both at the same Cockpit:

```sh
mkdir -p ~/.opencode-v1 && cd ~/.opencode-v1 && npm i opencode-ai@1.18.32
# then run it as ~/.opencode-v1/node_modules/.bin/opencode, or alias it
```

## What differs on OpenCode 2

Everything Cockpit does works on both. Where OpenCode 2 gives a plugin less to work with, this is
what you will notice:

| | OpenCode 1 | OpenCode 2 |
| --- | --- | --- |
| **`shell_start` permission** | asks with your `bash` permission rules | runs without asking — v2 gives a plugin tool no way to ask |
| **Tool calls in the chat** | `shell_start`, `review_list`… | `execute`, calling them in Code Mode — same tools, same results |
| **Updating** | `/plugins-update`, or `npx opencode-cockpit@latest update` | change the version in `opencode.json`; Cockpit's updater edits OpenCode 1's files only |
| **Statusline `lsp` segment** | language servers | empty — v2 does not expose them to plugins |
| **Colours** | the theme | the same theme, except the subtle border grey, one shade lighter |

:::caution[The permission difference]
On OpenCode 1, an agent starting a background shell asks first unless your rules allow it. On
OpenCode 2 it does not. If you rely on `bash` permission rules to keep an agent from running
commands, know that `shell_start` is not held by them there.

We are working on this: finding how a plugin tool can ask on OpenCode 2 — its tools accept a
permission setting that is not documented yet — so `shell_start` respects your `bash` rules there
the way it does on OpenCode 1.
:::

These track what OpenCode 2 exposes; each is revisited as it grows.
