<!-- Written by `bun packages/client/src/cli/reference.ts` from packages/client/src/catalog.ts. Do not edit by hand: a test fails when this file and the code disagree. -->

# Cockpit settings reference

Two files, both JSONC (comments and trailing commas are fine), the same shape:

- global, every project: `~/.config/opencode-cockpit/config.json` (`$XDG_CONFIG_HOME/opencode-cockpit/config.json` when that is set)
- one project: `<project>/.cockpit.json`, which wins over the global file key by key

Plugin-entry options win over both, but put settings in the files: on OpenCode 1 a plugin entry's
options are split across `opencode.json` and `tui.json`. `cockpit_settings` gives the exact paths.
Settings are read when OpenCode starts: a change applies after a restart.

## The top level

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
| `sidebar` | list of `"status"`, `"subagents"`, `"shell"`, `"trail"`, `"trust"` | `["status","subagents","shell","trail","trust"]` | the order of the sidebar blocks, top to bottom. A bay left out keeps its default place after the named ones. A project's list replaces the global one. Only an order: it turns nothing on or off |
| `features` | `{ "<bay>": false }` | all on | turns a bay off, like its `enabled: false` |
| `"<bay>"` | object | | one section per bay: `status`, `subagents`, `shell`, `trail`, `trust`, `review`, `updater` |

## `enabled` and `sidebar` are different switches

- `enabled: false` turns the bay off: no block, no commands, no agent tools. Use it for a bay you do not want at all.
- `sidebar: false` hides only the bay's block. The bay keeps working: its commands, panes and agent tools stay.
  For Status, `"sidebar": false` moves its line under the prompt (`"surface": "bottom"`).
- `hideWhenEmpty: true` keeps the block but draws nothing while there is nothing to list.

## `status` — the statusline: context, tokens, spend, git — a table in the sidebar, or a line under the prompt

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | the bay runs at all, both halves. `false` turns it off entirely: no block, no commands, no tools |
| `sidebar` | boolean | true (the table in the sidebar) | draw the bay's block in the sidebar. Only the block: with `false` the bay still runs, its commands and tools still work |
| `sidebarRows` | number | 14 with the `sidebar` preset, else 8 | rows the block lists before the rest fold into `+ N more` |
| `surface` | "sidebar" \| "bottom" | "sidebar" | where the line draws; `"sidebar": false` says `"bottom"` too |
| `preset` | string | the surface's own: `sidebar` in the sidebar, `default` at the bottom | a whole line by name; anything written beside it wins. The `status-setup` skill has them all |
| `segments` | list | the preset's | the line's parts, built-ins or your own — the whole list, replacing the preset's. To change a row or two, `override` |
| `override` | object | none | changes to the preset's segments by name, the rest kept: `false` drops one, a name swaps it, an object merges into its settings — `{ "git": { "against": "branch" } }` |
| `lines` | list | one line | more than one line, each with its own `surface`, `segments`, `maxRows`… |
| `separator` | string | `" │ "` across, nothing down | drawn between segments |
| `stack` | "horizontal" \| "vertical" | vertical in the sidebar | segments across or down |
| `icons` | boolean | `true` | built-in icons; off for a terminal missing the glyphs |
| `debug` | boolean | `false` | draw a placeholder where a segment said nothing |
| `paddingLeft` | number | 3 at the bottom, 0 in the sidebar | columns of space left of the line |
| `paddingRight` | number | 2 at the bottom, 0 in the sidebar | columns of space right of the line |
| `paddingTop` | number | 0 | rows of space above the line |
| `paddingBottom` | number | 1 at the bottom, 0 in the sidebar | rows of space below the line |
| `commands` | object | none | shell commands usable as segments — a Claude Code statusline script works unchanged |
| `modules` | string[] | none | your own segments in TypeScript; a project's add to the global ones |

## `subagents` — the subagents a conversation launched, live

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | the bay runs at all, both halves. `false` turns it off entirely: no block, no commands, no tools |
| `sidebar` | boolean | `true` | draw the bay's block in the sidebar. Only the block: with `false` the bay still runs, its commands and tools still work |
| `sidebarRows` | number | `6` | rows the block lists before the rest fold into `+ N more` |
| `hideWhenEmpty` | boolean | `false` | `true`: no block at all while there is nothing to list. `false`: the heading and `none yet`, so you can see the bay is there |
| `keybinds` | object | `cockpit.subagents.open`: `<leader>d` | keys for its commands, `{ "<command>": "<key>" }` |
| `hideFinishedAfterMinutes` | number | unset: kept for the conversation | minutes a finished subagent stays in the sidebar (still reachable from `/subagents`) |
| `hideNestedAfterSeconds` | number | `30` | seconds a finished nested subagent stays in the sidebar; negative keeps them |
| `guidance` | boolean | `true` | tell the agent how to follow, wait on and read its subagents (system prompt) |

## `shell` — background shells the agent started, with a dock under the chat and a console

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | the bay runs at all, both halves. `false` turns it off entirely: no block, no commands, no tools |
| `sidebar` | boolean | `true` | draw the bay's block in the sidebar. Only the block: with `false` the bay still runs, its commands and tools still work |
| `sidebarRows` | number | `5` | rows the block lists before the rest fold into `+ N more` |
| `hideWhenEmpty` | boolean | `false` | `true`: no block at all while there is nothing to list. `false`: the heading and `none yet`, so you can see the bay is there |
| `keybinds` | object | `cockpit.shells.dock`: `<leader>o`, `cockpit.shells.console`: `<leader>j` | keys for its commands, `{ "<command>": "<key>" }` |
| `hideFinishedAfterMinutes` | number | `30` | minutes a finished shell stays in the folded views |
| `dockHeight` | number | `14` | rows of the shells panel under the chat |
| `dockOpen` | boolean | as you last left it | the panel starts open |
| `defaultView` | "screen" \| "log" | `"screen"` | what the console opens on: the live screen or the clean log |
| `colors` | boolean | `true` | paint the colours programs print |
| `guidance` | boolean | `true` | tell the agent how to use shells (system prompt, ~120 tokens) |
| `listRunningShells` | number | `15` | running shells named in the system prompt each turn; `0` off |
| `lifecycle` | object | `onExit: "stopMine"`, `orphanAfterMinutes: 60`, `removeFinishedAfterMinutes: 30` | when shells end: `onExit` (`"stopMine"` or `"keep"`, which survives a restart) and the two timers |
| `defaults` | object | none | applied to every shell the agent starts: `watch`, `logFile`, `idleTimeoutSeconds`, `timeoutSeconds`, `notifyOnExit` |
| `notify` | object | `exit: true`, `watch: true`, `tailLines: 15` | what may interrupt the agent |
| `watch` | object | `auto: false` | health watching: `presets` (your own rules), `auto` (attach one to every shell) |
| `kinds` | object | none | your own shell categories, name → regular expression on the command |

## `trail` — what a conversation made or changed: PRs, branches, issues, links

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | the bay runs at all, both halves. `false` turns it off entirely: no block, no commands, no tools |
| `sidebar` | boolean | `true` | draw the bay's block in the sidebar. Only the block: with `false` the bay still runs, its commands and tools still work |
| `sidebarRows` | number | `5` | rows the block lists before the rest fold into `+ N more` |
| `hideWhenEmpty` | boolean | `false` | `true`: no block at all while there is nothing to list. `false`: the heading and `none yet`, so you can see the bay is there |
| `keybinds` | object | `cockpit.trail.open`: `<leader>f` | keys for its commands, `{ "<command>": "<key>" }` |

## `trust` — what Trust answered for you instead of asking; its block is off by default

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | the bay runs at all, both halves. `false` turns it off entirely: no block, no commands, no tools |
| `sidebar` | boolean | `false` | draw the bay's block in the sidebar. Only the block: with `false` the bay still runs, its commands and tools still work |
| `sidebarRows` | number | `3` | rows the block lists before the rest fold into `+ N more` |
| `keybinds` | object | `cockpit.trust.ledger`: `<leader>p` | keys for its commands, `{ "<command>": "<key>" }` |
| `threshold` | number | `3` | approvals in a row, by you, before Trust answers |
| `dangerExtra` | number | `5` | what a dangerous command costs on top |
| `expireDays` | number | `30` | days unused before trust has to be earned again; `0` never |

## `review` — the pane for reviewing changes; no sidebar block

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | the bay runs at all, both halves. `false` turns it off entirely: no block, no commands, no tools |
| `keybinds` | object | `cockpit.review.open`: `<leader>v`, `cockpit.review.place`: `<leader>k` | keys for its commands, `{ "<command>": "<key>" }` |
| `variant` | "right" \| "full" | `"right"` | where the pane opens |
| `source` | "worktree" \| "branch" | `"worktree"` | what it reviews on open: uncommitted work, or the whole branch |

## `updater` — checks for plugin updates once a day; no sidebar block

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | the bay runs at all, both halves. `false` turns it off entirely: no block, no commands, no tools |
| `updateCheck` | boolean | `true` | check for plugin updates once a day and say so |

## Names from before 0.9

Not read at all. Each one found is a notice in `cockpit_settings` and a `!` row in its bay. In the
same file, move the value to the new name and remove the old one:

| Old | New |
| --- | --- |
| `statusline` | `status` |
| `status.maxRows` | `status.sidebarRows` |
| `watch` | `shell.watch` |
| `kinds` | `shell.kinds` |
| `defaults` | `shell.defaults` |
| `lifecycle` | `shell.lifecycle` |
| `notify` | `shell.notify` |
| `guidance` | `shell.guidance` |
| `listRunningShells` | `shell.listRunningShells` |
| `ui.<key>` | `shell.<key>` |
| `ui.historyMinutes` | `shell.hideFinishedAfterMinutes` |
| `ui.updateCheck` | `updater.updateCheck` |
| `ui.sidebarOrder` | the top-level `sidebar` list (remove it) |
| `<bay>.sidebarOrder` | the top-level `sidebar` list (remove it) |
| `subagents.hideFinishedAfter` | `subagents.hideFinishedAfterMinutes` |
| `subagents.hideNestedAfter` | `subagents.hideNestedAfterSeconds` |
| Status keys at the file's root (`preset`, `segments`, `enabled`…) | the same keys under `status` |
