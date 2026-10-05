---
title: Configuration
description: Every bay's settings in one file, read by both halves of the plugin — the whole shape, each bay's keys and defaults, and the names from before 0.9.
---

Every bay reads the same two files, and nothing else needs touching:

```
~/.config/opencode-cockpit/config.json   →   <project>/.cockpit.json
```

The global file applies everywhere (`XDG_CONFIG_HOME` is honoured); a project's file wins over it,
section by section and key by key, so it can change one setting without restating the rest. A list
replaces the one before it. Both halves of a bay — the agent's tools and the interface — read the
same section, so a bay is configured in one place, not once in `opencode.json` and again in
`tui.json`. Comments and trailing commas are fine. Everything is optional: with no file at all you
get the defaults below.

## The easy way: /cockpit-setup

Type `/cockpit-setup`, or just ask — "make my sidebar quieter", "hide the shells block when it's
empty", "move trail above subagents". The agent loads the `cockpit-setup` skill that ships with
Cockpit and reads what is installed and written now with its `cockpit_settings` tool: every value
and where it came from, every name it does not read, OpenCode's own sidebar blocks. It fixes those
first, offers a starting point (everything visible, quiet, minimal,
or Status as a line under the prompt), asks only what is left, one question at a time, writes the
smallest file that does it, and checks it reads back with no notices. It asks before touching
OpenCode's own files, and never suggests turning OpenCode's Todo block off. From the home screen the
command opens a conversation; while the agent is answering, it waits its turn (`1 queued`). It is in
the palette too (`ctrl+p`, "cockpit").

**Then, if you want it: "tune it to how you work."** With the blocks set, the agent offers a second
phase (`cockpit_settings` with `tune: true`):

- **A tour** of each bay you have on, with its real key and command as you have them set.
- **Your project's conventions:** which commands keep running — found in `package.json` scripts, a
  Makefile, a compose file or a Procfile — and belong in a background shell; your ticket prefix,
  offered from your branch names and commits, so Trail groups by ticket; where PRs go; whether to
  explore in background subagents.

After you agree, the `cockpit_conventions` tool writes them as one `## Cockpit conventions` section
in this project's `AGENTS.md` or OpenCode's global one. A rerun replaces that section in place and
keeps every other byte of the file. It holds conventions only: how to use each bay is already in
every request.

Settings are read when OpenCode starts, so a change applies after a restart.


## The whole shape

```jsonc title="~/.config/opencode-cockpit/config.json"
// a project's .cockpit.json takes the same shape
{
  "sidebar": ["status", "subagents", "shell", "trail", "trust"],   // the order, top to bottom
  "features": { "trust": false },                                  // switch a whole bay off

  "status":    { "preset": "sidebar", "sidebarRows": 14 },
  "subagents": { "sidebarRows": 6, "hideWhenEmpty": false, "hideFinishedAfterMinutes": 60 },
  "shell":     { "sidebarRows": 5, "dockHeight": 16, "lifecycle": { "onExit": "keep" } },
  "trail":     { "sidebar": true, "sidebarRows": 5 },
  "trust":     { "sidebar": true, "threshold": 3 },
  "review":    { "variant": "right", "source": "worktree" },
  "updater":   { "updateCheck": true }
}
```

One section per bay, and nothing at the top level but `sidebar` and `features`.

## Keys every bay shares

Spelled the same in every section:

| Key | | Default |
| --- | --- | --- |
| `enabled` | The bay's off switch, both halves. `features.<bay>: false` does the same | `true` |
| `sidebar` | Draw the bay's sidebar block — a boolean here; the top-level `sidebar` is the order. For Status, `false` puts its line at the bottom, under the prompt | `true`; Trust `false` |
| `sidebarRows` | Rows the block lists before the rest fold into `+ N more` | Status 8 (its table 14), Subagents 6, Shell 5, Trail 5, Trust 3 |
| `hideWhenEmpty` | Subagents, Shell and Trail. `false`: with nothing to list the block still says it is there — its heading and `none yet`. `true`: no block at all until there is something | `false` |
| `keybinds` | Keys for the bay's commands, `{ "<command>": "<key>" }` | each bay's own |

Time keys carry their unit: `hideFinishedAfterMinutes`, `hideNestedAfterSeconds`.

## Keys

The same on OpenCode 1 and 2, and none of them one of OpenCode's own. `<leader>` is OpenCode's
leader, `ctrl+x` unless you changed it.

| Key | Command | Does |
| --- | --- | --- |
| `ctrl+x d` | `cockpit.subagents.open` | Subagents: the one working now |
| `ctrl+x o` | `cockpit.shells.dock` | Shell: the panel under the chat |
| `ctrl+x j` | `cockpit.shells.console` | Shell: the console |
| `ctrl+x f` | `cockpit.trail.open` | Trail: `/trail` |
| `ctrl+x p` | `cockpit.trust.ledger` | Trust: `/trust` |
| `ctrl+x v` | `cockpit.review.open` | Review: open or close the changes |
| `ctrl+x k` | `cockpit.review.place` | Review: the right pane or full screen |

Set one in its bay's `keybinds` — `{ "subagents": { "keybinds": { "cockpit.subagents.open":
"<leader>w" } } }` brings back the key from before 0.9 — or `"none"` to unbind it. Every command
also has a slash name or a palette entry, so nothing depends on a key being free.

## The sidebar order

One list, at the top of either file, and nowhere else:

```json
{ "sidebar": ["status", "subagents", "shell", "trail", "trust"] }
```

That is the default. A project's list replaces the global one (it is an order, not a set), and a bay
the list leaves out keeps its default place after the ones it names. On OpenCode 1 Cockpit's blocks
sit together under OpenCode's own Context block and above the rest. An entry that is not a bay —
`"shells"` — is not silently ignored: a `!` row asks whether you meant `"shell"`.

:::note[OpenCode 2, separate packages]
On OpenCode 2 the bundle applies the list. **Installed as separate packages, the blocks draw in the
order the packages are listed in `cli.json`**, so list them in the order you want them.
:::

## status

The Status bay. The rest of it — segments, lines, modules — is under
[Segments and layout](/status/configuration/).

| Key | | Default |
| --- | --- | --- |
| `preset` | A whole line by name: `sidebar` (the table), `minimal`, `default`, `detailed` (bottom lines). Anything written beside it wins | `sidebar` |
| `surface` | `sidebar` or `bottom`; `"sidebar": false` says the same | `sidebar` |
| `segments` | The line's parts, built-ins or your own — the whole list, replacing the preset's | the preset's |
| `override` | Changes to the preset's segments by name, the rest kept: `false` drops one, a name swaps it, an object merges into its settings — `{ "git": { "against": "branch" } }` | none |
| `lines` | More than one line, each with its own `surface`, `segments`, `maxRows`… | one |
| `separator`, `stack`, `icons`, `debug`, `padding*` | How a line is laid out | per surface |
| `commands` | Shell commands usable as segments — your Claude Code statusline script, unchanged | none |
| `modules` | Your own segments in TypeScript; a project's add to the global ones | none |

## subagents

See [Subagents](/subagents/overview/#settings).

| Key | | Default |
| --- | --- | --- |
| `hideFinishedAfterMinutes` | Minutes a finished subagent stays in the sidebar | unset: the whole conversation |
| `hideNestedAfterSeconds` | Seconds a finished *nested* subagent stays; negative keeps them | `30` |
| `guidance` | Tell the agent about background subagents and follow-ups | `true` |

## shell

| Key | | Default |
| --- | --- | --- |
| `kinds` | Your own shell categories, name → regex on the command | none |
| `watch` | `presets` (your own rules) and `auto` (attach one to every shell) | `auto: false` |
| `defaults` | Applied to every shell the agent starts: `watch`, `logFile`, `idleTimeoutSeconds`, `timeoutSeconds`, `notifyOnExit` | none |
| `lifecycle` | `onExit` (`stopMine` or `keep`), `orphanAfterMinutes`, `removeFinishedAfterMinutes` | `stopMine`, `60`, `30` |
| `notify` | What may interrupt the agent: `exit`, `watch`, `tailLines` | on |
| `guidance`, `listRunningShells` | The system-prompt paragraph, and how many running shells it names | `true`, `15` |
| `dockHeight`, `dockOpen`, `defaultView`, `colors` | The panel under the chat and the console | `14`, as last left, `screen`, `true` |
| `hideFinishedAfterMinutes` | How long a finished shell stays in the folded views | `30` |

```jsonc
{
  "shell": {
    "kinds": { "e2e": "playwright|cypress", "infra": "^(terraform|pulumi)\\b" },
    "watch": {
      "auto": false,
      "presets": { "e2e": { "done": "\\d+ passed", "fail": "\\d+ failed" } }
    },
    "defaults": { "logFile": true, "timeoutSeconds": 900 },
    "notify": { "exit": true, "watch": true, "tailLines": 15 },
    "dockHeight": 16,
    "dockOpen": true
  }
}
```

**kinds** are extra shell categories, or overrides, as `name` → regular expression matched against
the command. They drive the badge in the panel and sidebar and the `kind` filter in `shell_list`, so
you can group your own stack instead of the built-ins (`server`, `tests`, `build`, `watcher`,
`task`).

**watch.presets** are your own rules, keyed by name, and they reach the daemon as explicit rules — so
a preset you invent works immediately. `auto` attaches a matching preset to every new shell; **off
by default**.

**lifecycle** says when shells end without being asked to. `onExit` decides what happens to the
shells an OpenCode window started when that window closes: `stopMine` (the default) stops them,
`keep` leaves them running for the next window — which is how a shell survives an OpenCode restart.
`orphanAfterMinutes` stops a shell that no window of its own has been connected to for that long, so
nothing can quietly run for a week; `0` turns it off. `removeFinishedAfterMinutes` removes a shell
the agent started that long after it exits cleanly; failed ones stay until `/shells-clear`.

:::note[Two windows]
A window closing only counts once **both halves** of the plugin have disconnected, so quitting one
of two open OpenCodes never stops the other's shells.
:::

**guidance and listRunningShells** are the context budget. `guidance` is the paragraph that teaches
the model when to reach for a shell (~120 tokens per request); `listRunningShells` is how many
running shells are named in the system prompt each turn (~20 tokens each, `0` disables). Turning both
off saves tokens at the cost of a model that uses shells less well.

**dockOpen** decides how the panel starts: set it and it always starts that way; leave it out and it
starts however you last left it.

## trail

Nothing beyond the shared keys. Its block is on by default, and `ctrl+x f` (`cockpit.trail.open`)
opens `/trail`. See [Trail](/trail/overview/#settings).

## trust

See [Trust](/trust/overview/#settings).

| Key | | Default |
| --- | --- | --- |
| `threshold` | Approvals in a row, by you, before Trust answers | `3` |
| `dangerExtra` | What a dangerous command costs on top | `5` |
| `expireDays` | Days unused before trust has to be earned again; `0` never | `30` |

Its block is off by default: `"sidebar": true` shows it, and the palette flips it for the session.

## review

No sidebar block. See [Panel and keys](/review/interface/#settings).

| Key | | Default |
| --- | --- | --- |
| `variant` | Where the panel opens: `right` or `full` | `right` |
| `source` | What it reviews on open: `worktree` (uncommitted) or `branch` | `worktree` |

## updater

See [Updater](/updater/overview/).

| Key | | Default |
| --- | --- | --- |
| `updateCheck` | Check for plugin updates once a day and say so | `true` |

## Names from before 0.9

0.9 gave every bay the same shape, so some names changed. **The old ones are not read**, and since
0.10 they are names like any other Cockpit does not know: [doctor](/help/doctor/) and
`/cockpit-setup` list each one, and a top-level one is a `!` row at the top of Status's column:

```
! settings: "statusline" is not a setting: did you mean "status"?
```

To move a file from before 0.9:

| Before 0.9 | Now |
| --- | --- |
| `statusline` | `status` |
| `status.maxRows` | `status.sidebarRows` |
| Shell's keys at the file's root (`kinds`, `watch`, `defaults`, `lifecycle`, `notify`, `guidance`, `listRunningShells`) | the same keys under `shell` |
| `ui.dockHeight`, `ui.dockOpen`, `ui.sidebarRows`, `ui.colors`, `ui.keybinds`… | the same keys under `shell` |
| `ui.historyMinutes` | `shell.hideFinishedAfterMinutes` |
| `ui.updateCheck` | `updater.updateCheck` |
| `ui.sidebarOrder`, `<bay>.sidebarOrder` | the top-level `sidebar` list |
| `subagents.hideFinishedAfter`, `subagents.hideNestedAfter` | `…Minutes`, `…Seconds` |
| Status's keys at the file's root (`preset`, `segments`, `enabled`…) | the same keys under `status` |

A file that is not valid JSON, a top-level name nothing reads, or a value of the wrong kind gets a
`!` row too, and the defaults — never a silently blank sidebar.

## OpenCode's own sidebar blocks

Status's table carries what OpenCode's own Context block says. To keep only one, switch the host's
off — it is OpenCode's setting, in OpenCode's file, and the name differs by version:

```jsonc title="OpenCode 1 — ~/.config/opencode/tui.json"
{ "plugin_enabled": { "internal:sidebar-context": false } }
```

```jsonc title="OpenCode 2 — ~/.config/opencode/cli.json"
{ "plugins": ["opencode-cockpit@0.9.0", "-opencode.sidebar.context"] }
```

The other blocks switch the same way, by these ids. Hiding them is a matter of taste: Status's table
already warns when an MCP or language server fails, and `opencode mcp list` still lists them all.

| Block | OpenCode 1 (`tui.json`, `plugin_enabled`) | OpenCode 2 (`cli.json`, `plugins`) |
| --- | --- | --- |
| Context | `internal:sidebar-context` | `opencode.sidebar.context` |
| MCP | `internal:sidebar-mcp` | `opencode.sidebar.mcp` |
| Footer (path and branch) | `internal:sidebar-footer` | `opencode.sidebar.footer` |
| LSP | `internal:sidebar-lsp` | — |
| Files | `internal:sidebar-files` | — |
| Todo | `internal:sidebar-todo` | — |

An `internal:` id in OpenCode 2's `cli.json` does nothing, silently. Leave OpenCode's Todo block on:
nothing in Cockpit replaces it. `/cockpit-setup` reads these files, says what each block is set to,
and asks before changing them.

## Advanced: options on the plugin entry

The same keys can also go on the plugin entry — the bundle's `["opencode-cockpit", { "shell": { … } }]`
or a single bay's own `["@opencode-cockpit/shell", { … }]` — where they win over both files. It is
rarely worth it: on OpenCode 1 the interface's options belong in `tui.json` and the agent's in
`opencode.json`, so the same bay ends up configured in two places. The files are read by both.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `COCKPIT_HOME` | `~/.cache/opencode-cockpit` | Socket, logs, process registry |
| `COCKPIT_IDLE_TIMEOUT_MS` | `600000` | Daemon exits after this long unused |
| `COCKPIT_LOG_LEVEL` | `info` | `debug` for verbose daemon logs |
