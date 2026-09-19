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
| `git.diff` | `+150 / -30` for the session | |
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
