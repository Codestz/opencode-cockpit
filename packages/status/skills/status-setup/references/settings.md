<!-- Written by `bun packages/status/src/cli/reference.ts` from the Status bay's code. Do not edit by hand: a test fails when this file and the code disagree. -->

# Status settings reference

Everything goes in the `"status"` section of `~/.config/opencode-cockpit/config.json` (every project) or
`<project>/.cockpit.json` (this one). JSONC. Read when OpenCode starts: a change applies after a restart.
`cockpit_settings` gives the exact paths and what is written now.

## Keys

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | the bay runs at all, both halves. `false` turns it off entirely: no block, no commands, no tools |
| `sidebar` | boolean | true (the table in the sidebar) | draw the bay's block in the sidebar. Only the block: with `false` the bay still runs, its commands and tools still work |
| `sidebarRows` | number | 14 with the `sidebar` preset, else 8 | rows the block lists before the rest fold into `+ N more` |
| `surface` | "sidebar" \| "bottom" | "sidebar" | where the line draws; `"sidebar": false` says `"bottom"` too |
| `preset` | string | the surface's own: `sidebar` in the sidebar, `default` at the bottom | a whole line by name; anything written beside it wins. The `status-setup` skill has them all |
| `segments` | list | the preset's | the line's parts, built-ins or your own |
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

A line in `"lines": [ … ]` takes `preset`, `surface`, `segments`, `separator`, `stack`, `icons`, `debug`,
`maxRows` (its own row cap) and the paddings; anything a line leaves out comes from the section.

## Presets

A preset fills in what is not written; anything written beside it wins.

| Preset | Surface | What it shows | Segments |
| --- | --- | --- | --- |
| `minimal` | bottom | how full the context is, and what changed | `context` `git.diff` `session.status` `diagnostics` |
| `default` | bottom | the capacity bar, where the tokens went, what changed, how long | `context` `tokens` `tokens` `tokens` `tokens` `git.diff` `session.time` `todo` `session.status` `diagnostics` |
| `detailed` | bottom | everything the built-ins know, for a wide window | `context` `tokens` `model` `cost` `git.diff` `todo` `session.time` `session.status` `diagnostics` |
| `sidebar` | sidebar (the default) | a table: the window, where the tokens went, a proxy's budget, the branch's diff | `title` `context` `session.status` `tokens` `in` `out` `cache` `write` `sep` `spend` `avail` `sep` `git` |

## Built-in segments

Write a name (`"cwd"`), or the name with settings (`{ "type": "context", "style": "bar" }`). Every
segment also takes `prefix`, `suffix`, `priority` (higher survives a narrow line), `color` (a tone:
`text muted accent success warning error info`, or `#rrggbb`) and `icon`.

| Segment | What it says |
| --- | --- |
| `cwd` | the folder, shortened from the left (`maxWidth`, default 28) |
| `git.branch` | the branch; muted on the default branch |
| `git.diff` | what is uncommitted: `+added / -removed` (`format` with `{files}`, `{added}`, `{removed}`) |
| `model` | the model, short (`full: true` for its whole id) |
| `context` | how full the window is: `style` `"percent"` (default), `"bar"`, `"solid"` (the table's), `"split"` (cache, input, output in one bar); `width`, `warnAt` 0.75, `dangerAt` 0.9 |
| `tokens` | the token total; `format` with `{total}`, `{input}`, `{output}`, `{cacheRead}`, `{cacheWrite}`; `style` `"row"` (the table's) or `"parts"` |
| `cost` | what the session cost, hidden when nothing is priced (`showZero`, `currency`) |
| `todo` | todo progress, `3/7`; hidden when all are done (`showComplete`) |
| `session.status` | why a turn stalled, `retry 2 in 5s`; silent otherwise |
| `session.time` | how long: the session, or the last answer with `of: "turn"` (`coarse` for minutes) |
| `diagnostics` | errors and warnings from the language servers |
| `version` | the Cockpit version |
| `text` | a fixed `value`: `{ "type": "text", "value": "hi" }` |
| `command` | a shell command's output: `{ "type": "command", "name": "<one of commands>" }` (`row` for one line of many) |
| `title` | the table's heading, "Context" (`text` to rename it) |
| `in` | table row: fresh prompt tokens, with their share |
| `out` | table row: output and reasoning tokens, with their share |
| `cache` | table row: tokens read from cache, with their share |
| `write` | table row: tokens written to cache, with their share |
| `sep` | a hairline between groups; drawn only with a row on both sides |
| `spend` | table row: a proxy's spend, from its budget file; silent without one |
| `avail` | table row: what is left of a proxy's budget; silent without one |
| `git` | table row: the branch's whole diff against its base |

## Commands

Any CLI's output as a segment — an existing Claude Code statusline script runs unchanged:

```jsonc
"commands": { "budget": { "run": "~/bin/budget.sh", "intervalMs": 2000, "timeoutMs": 1000 } },
"segments": ["context", { "type": "command", "name": "budget" }]
```

`claudeCodeCompat` (default true) feeds the command Claude Code's statusline JSON on stdin.

## Modules

For what needs the session read, a decision, or memory across ticks (a rate, a trend): a TypeScript
module listed in `"modules"`, exporting `{ segments: { name(ctx, config) { return { runs: [...] } } } }`
against `@opencode-cockpit/status/segment`. It is handed a snapshot, not OpenCode's api, and called on
every repaint; returning `undefined` hides the segment. Its segments are used by name like built-ins.
