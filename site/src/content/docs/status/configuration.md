---
title: Segments and layout
description: Every built-in segment, the surfaces they sit on, and how a line survives a narrow terminal.
---

Settings live in `~/.config/opencode-cockpit/config.json` for every project, `<project>/.cockpit.json`
for one, and on the plugin entry itself, which beats both.

```jsonc
{
  "statusline": {
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
fatal: a config written against a newer version costs you a segment, not the line.

## Built-in segments

| Name | Shows | Settings |
| --- | --- | --- |
| `cwd` | folder, relative to the worktree | `maxWidth` |
| `git.branch` | current branch, dimmed on the default branch | |
| `git.diff` | `+150 / -30` — what is uncommitted in the working tree | |
| `model` | `claude-opus-5` | `full` |
| `context` | how full the window is | `style`, `width`, `warnAt`, `dangerAt` |
| `tokens` | `78.5k tok` | |
| `cost` | session spend | `currency`, `showZero` |
| `todo` | `3/7 todo` | `showComplete` |
| `session.status` | working, or a retry and its countdown | |
| `session.time` | elapsed | `coarse` |
| `diagnostics` | unhealthy LSP and MCP servers | |
| `version` | the bay's version | |
| `text` | literal text | `value` |
| `command` | a shell command's output | `name`, `row` |

Every one also takes `prefix`, `suffix`, `priority`, `color` and `icon`.

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
  "statusline": {
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

The sidebar you see is not one panel — each block is an **internal plugin**, and `tui.json` can
switch any of them off:

```jsonc
// ~/.config/opencode/tui.json
{
  "plugin": ["opencode-cockpit"],
  "plugin_enabled": { "internal:sidebar-context": false }
}
```

That removes OpenCode's own `Context / tokens / % used / spent` block, leaving the space to a
`sidebar` line of your own. It is the honest way to avoid the same figure twice: rather than this
bay staying quiet about what the host says, you turn off the half you would rather not read.

| Plugin | What it draws |
| --- | --- |
| `internal:sidebar-context` | tokens, context percentage, spend |
| `internal:sidebar-files` | files this session changed |
| `internal:sidebar-todo` | the todo list |
| `internal:sidebar-lsp` | language-server status |
| `internal:sidebar-mcp` | MCP server status |
| `internal:sidebar-footer` | the path and version at the bottom |
| `internal:home-footer`, `internal:home-tips` | the home screen's furniture |
| `internal:notifications` | toasts |

`api.plugins.list()` prints the current set, so the list above can be checked rather than trusted.

## The context segment

Four styles, because a context meter is the segment people care most about.

| `style` | Draws |
| --- | --- |
| `percent` | `39% ctx` |
| `bar` | a plain bar with end caps |
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
  "statusline": {
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
| `separator` | `" · "` across, nothing down |
| `stack` | `vertical` in the sidebar, `horizontal` elsewhere |
| `maxRows` | `8`, vertical only |
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

## sidebarOrder

Where the line sits among the other bays in the sidebar. Lower draws first; the statusline defaults
to 200 and Shell's list to 150, so the shells are above it.

```json title="~/.config/opencode-cockpit/config.json"
{
  "statusline": { "surface": "sidebar", "sidebarOrder": 100 }
}
```

That puts the line above the shells. It has no effect on the bottom surface, where there is nothing
to share the row with.
