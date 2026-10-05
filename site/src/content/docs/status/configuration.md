---
title: Segments and layout
description: Every built-in segment, the surfaces they sit on, and how a line survives a narrow terminal.
---

Settings live in the `status` section of `~/.config/opencode-cockpit/config.json` for every
project, and of `<project>/.cockpit.json` for one. Comments and trailing commas are fine. The keys
every bay shares, the sidebar order and the names from before 0.9 are on
[Configuration](/configuration/).

## Presets

A whole line by name, built-ins only — nothing to install, nothing to write:

```jsonc
{ "status": { "preset": "default" } }
```

| Preset | Surface | What you get |
| --- | --- | --- |
| `sidebar` | sidebar | **the default**: a table — the window as one bar, the tokens in named rows, a proxy's budget, the branch's diff |
| `minimal` | bottom | how full the context is, and what changed |
| `default` | bottom | the bar, where the tokens went, what changed, how long |
| `detailed` | bottom | everything the built-ins know, for a wide window |

```
Status
████████████████
tokens 85.2k · 43%
in     265 · 0%
out    60 · 0%
cache  84.9k · 100%
──────────────
spend  $26.24
avail  $173.76 · 87% left
──────────────
git    5f +312 -48
```

That is the `sidebar` preset, and what you get with no configuration at all. A row with nothing to
say is not drawn — `spend` and `avail` with no proxy writing a budget, a hairline with nothing on
one side of it. `{ "status": { "sidebar": false } }`, or `"surface": "bottom"`, draws the `default`
line under the prompt instead. Anything you write beside a preset wins, so it is a starting point
and not a mode; a name that is not a preset draws the surface's own line, with a `!` row naming the
presets there are.

## Changing a row or two

`override` changes the preset's segments by name and keeps every other row, so the table goes on
following the preset:

```jsonc
{
  "status": {
    "override": {
      "git": { "against": "branch" },        // an object merges into that segment's settings
      "write": false,                         // false drops it
      "session.status": { "working": true }, // the turn's clock as well as a retry
      "spend": "cost"                         // a name swaps it, in the same place
    }
  }
}
```

A change applies to every segment of that name — `"sep": false` drops every hairline. With
`segments` written too, the override applies to those; a line in `lines` takes its own. A project's
`override` adds to the global one, key by key. A name that matches no segment is not silent:

```
! settings: override "gti" matches no segment in the sidebar preset — did you mean "git"?
```

Look at it before restarting: `bunx @opencode-cockpit/status preview --config <file>` reads the file
as OpenCode will — `preset`, `sidebarRows`, `override` and the `!` rows — and stops on a file it
cannot read or a flag it does not know. `--config -` reads it from stdin, as the file it will become
(`--as global` or `--as project`), so a change can be seen before it is written anywhere.
`--surface sidebar|bottom` draws there whatever the file says; the sidebar is 34 columns unless
`--width` says otherwise. `--debug` names every row — `✓git` drew, `✗spend` drew nothing, `?gti` is
no segment at all.

```sh
cat <<'EOF' | bunx @opencode-cockpit/status preview --config - --debug
{ "status": { "override": { "git": { "against": "branch" } } } }
EOF
```

The `status-setup` skill previews the same way, with the preview that came with your install —
`cockpit_settings` names it under Previews — never `bunx`, which would fetch another release.

## Your own line

```jsonc
{
  "status": {
    "surface": "bottom",
    "separator": " │ ",
    "segments": [
      "git.diff",
      { "type": "context", "style": "gradient", "width": 16 },
      { "type": "cost", "color": "#e8b923" },
      "diagnostics"
    ]
  }
}
```

A segment is a built-in's name, or that name with settings. An unknown name is skipped rather than
fatal: a config written against a newer version costs you a segment, not the line. `segments` is the
whole list and replaces the preset's; to change one row of a preset, `override` keeps the rest.

## Built-in segments

| Name | Shows | Settings |
| --- | --- | --- |
| `cwd` | folder, relative to the worktree | `maxWidth` |
| `git.branch` | current branch, dimmed on the default branch | |
| `git.diff` | `+150 / -30` — what is uncommitted in the working tree | |
| `model` | `claude-opus-5` | `full` |
| `context` | how full the window is | `style`: `percent` \| `bar` \| `solid` \| `gradient` \| `split`, `width`, `warnAt`, `dangerAt` |
| `tokens` | `78.5k tok`; `tokens 85.2k · 43%` as a table row | `format`, `style`: `parts` \| `row` |
| `title` | `Status`, bold: a column's heading | `text` |
| `in` · `out` · `cache` · `write` | `cache  84.9k · 100%` — one part of the window and its share; nothing when zero | |
| `sep` | a hairline between groups, drawn only with a row on either side | `width` |
| `spend` · `avail` | `spend  $26.24`, `avail  $173.76 · 87% left` — a proxy's budget; nothing without one | `file` |
| `git` | `git    5f +312 -48` — what is uncommitted; `"against": "branch"` counts the branch against where it forked (`… vs main`) | |
| `cost` | session spend | `currency`, `showZero` |
| `todo` | `3/7 todo` | `showComplete` |
| `session.status` | `working 1m02s` since your prompt, or a retry and its countdown; `"working": false` (the sidebar preset) keeps only the retry | |
| `session.time` | the conversation's age, or with `of: "turn"` how long the last answer took | `of`: `session` \| `turn`, `coarse` |
| `diagnostics` | `! name` for an unhealthy MCP or language server (OpenCode 2: MCP only); nothing while all are healthy | |
| `version` | the bay's version | |
| `text` | literal text | `value` |
| `command` | a shell command's output | `name`, `row` |

Every one also takes `prefix`, `suffix`, `priority`, `color` and `icon`.

## Which clock `session.time` is

`session.time` has two clocks, and `of` picks one:

| `of` | Shows | |
| --- | --- | --- |
| `"session"`, or left out | `2d 15h` | how old the conversation is, from its creation |
| `"turn"` | `took 3m42s` | how long the last answer took, from your prompt to the last reply after it; nothing while one is running, and nothing before the first |

```json
{ "type": "session.time", "of": "turn" }
```

Every built-in line and preset that shows the time uses the turn, so a conversation reopened two
days later no longer reads `2d 15h` with no word beside it. A line you wrote yourself keeps the
session's age until you add `of`. While a turn runs, `session.status` counts it from the same
prompt — `working 1m02s` — so the two never show the same clock twice.

## What `git.diff` counts

What is uncommitted: `git diff --shortstat HEAD`, so staged and unstaged changes together, against
the last commit. Untracked files are left out, because git cannot count lines in a file it has never
seen and a file count that moves without the line counts moving reads as a bug.

It used to report what *this session* changed, read from OpenCode's own file list. That number could
not be checked against anything, it counted nothing you edited by hand — and when the list came back
empty, which it did, the segment simply vanished, which looks exactly like a segment you never
configured. Git answers a slightly different question honestly, and you can always run the command
yourself to see the same number.

The command only runs when a line actually carries this segment, at most once every two seconds, on
the same schedule as any other command segment — a line without it spawns nothing.

Both questions are worth asking, and they are different questions — "what have I changed here" is
not "what has the agent changed this turn". The working tree needs a command, because a built-in
that shelled out would stop being a pure function of the snapshot, which is what makes every one of
them testable without a filesystem:

```jsonc
{
  "status": {
    "modules": ["<examples/bottom.ts>"],
    "commands": { "tree": { "run": "git diff --shortstat", "intervalMs": 5000 } },
    "segments": [
      { "type": "git.diff", "prefix": "uncommitted " },
      { "type": "worktree", "prefix": "tree " }
    ]
  }
}
```

`git diff --shortstat` prints `3 files changed, 12 insertions(+), 4 deletions(-)`, far too long for
a line — the `worktree` segment in `examples/bottom.ts` reads that and draws `3f +12 -4`.

`git.diff` also answers to `session.diff`, the name it had while the numbers came from the host.

## Replacing OpenCode's own sidebar blocks

The sidebar you see is not one panel — each block is a plugin of OpenCode's own, which its config
can switch off. The names differ by version:

```jsonc title="OpenCode 1 — ~/.config/opencode/tui.json"
{
  "plugin": ["opencode-cockpit"],
  "plugin_enabled": { "internal:sidebar-context": false }
}
```

```jsonc title="OpenCode 2 — ~/.config/opencode/cli.json"
{ "plugins": ["opencode-cockpit", "-opencode.sidebar.context"] }
```

That removes OpenCode's own `Context / tokens / % used / spent` block, leaving the space to the
table. It is the honest way to avoid the same figure twice: rather than this bay staying quiet about
what the host says, you turn off the half you would rather not read. `/cockpit-setup` offers it when
Status draws in the sidebar.

On OpenCode 1 the other blocks can go the same way:

| Plugin (OpenCode 1) | What it draws |
| --- | --- |
| `internal:sidebar-context` | tokens, context percentage, spend |
| `internal:sidebar-files` | files this session changed |
| `internal:sidebar-lsp` | language-server status |
| `internal:sidebar-mcp` | MCP server status |
| `internal:sidebar-footer` | the path and version at the bottom |
| `internal:sidebar-todo` | the todo list — leave it on, nothing in Cockpit replaces it |
| `internal:home-footer`, `internal:home-tips` | the home screen's furniture |

On OpenCode 2, `-internal:sidebar-context` does nothing — the block is `opencode.sidebar.context` —
and its sidebar has three blocks of its own: `opencode.sidebar.context`, `opencode.sidebar.mcp` and
`opencode.sidebar.footer`, each off with a `-` before it in `cli.json`'s `plugins`. It has no LSP or
Todo block. Leave OpenCode 1's Todo block on: nothing in Cockpit replaces it. `api.plugins.list()` prints the current set, so the list above can be checked rather
than trusted.

## The context segment

Five styles, because a context meter is the segment people care most about.

| `style` | Draws |
| --- | --- |
| `percent` | `39% ctx` |
| `bar` | a plain bar with end caps |
| `solid` | one solid bar on a dark track, no figure — the `sidebar` table's |
| `gradient` | a bar whose every cell is coloured by the level it stands for, green through amber to red |
| `split` | one bar coloured by what fills it — cache, fresh input, output |

`split` is the one worth knowing about: a session that is mostly re-reading its own cache looks
different from one that is mostly new input, and that difference is invisible in a percentage.

```jsonc
{ "type": "context", "style": "split", "width": 12, "warnAt": 0.7, "dangerAt": 0.9 }
```

Both hide themselves where no context window was declared. A percentage needs a denominator.

## Several lines

```jsonc
{
  "status": {
    "lines": [
      { "surface": "bottom", "segments": ["git.diff", "todo", "session.time"] },
      { "surface": "sidebar", "segments": ["context", "cost"] }
    ]
  }
}
```

Two lines on the same surface stack, which is how a two-row statusline is written.

Each line takes its own settings:

| Setting | Default |
| --- | --- |
| `override` | the section's `override` |
| `separator` | `" · "` across, nothing down |
| `stack` | `vertical` in the sidebar, `horizontal` elsewhere |
| `maxRows` | the bay's `sidebarRows` (8; the `sidebar` preset 14), vertical only |
| `icons` | on |
| `paddingLeft` / `Right` / `Top` / `Bottom` | per surface, to line up with OpenCode's own content |

## Colour

`color` takes a tone name or a literal. A tone follows whatever theme you run; a literal does not.

Tones: `text`, `muted`, `accent`, `success`, `warning`, `error`, `info`, and `background`, `panel`,
`border` for drawing against the window's own surfaces.

Prefer a tone. A statusline in someone else's palette is the first thing that makes a plugin look
bolted on.

## Icons

On by default, in single-width glyphs — an emoji is two cells wide in most terminals and one in a
few, which is exactly what shears a fixed-width line. Turn them off with `"icons": false`, globally
or per line, or set your own per segment with `"icon": "»"`.

## Where it sits in the sidebar

The top-level `"sidebar"` list says, for every bay at once — Status first by default:

```json title="~/.config/opencode-cockpit/config.json"
{ "sidebar": ["subagents", "shell", "status", "trail", "trust"] }
```

That puts the table under the shells. It has no effect on the bottom surface, where there is nothing
to share the row with. A `sidebarOrder` in the `status` section is not read. See [Configuration](/configuration/#the-sidebar-order).
