---
title: Claude Code statuslines
description: Run the statusline script you already wrote, colours and all.
---

A statusline segment can be a shell command, fed the same JSON on stdin that Claude Code's
`statusLine` hook sends. A script you already wrote works unchanged.

```jsonc
{
  "statusline": {
    "commands": { "mine": { "run": "~/.claude/statusline.sh", "intervalMs": 2000 } },
    "segments": [{ "type": "command", "name": "mine" }]
  }
}
```

| Setting | Default | |
| --- | --- | --- |
| `run` | — | the command, run through `sh -c` |
| `intervalMs` | `2000` | floor of 250ms; a command cannot be asked to run every frame |
| `timeoutMs` | `1000` | killed and ignored past this |
| `claudeCodeCompat` | `true` | send the payload on stdin |

## What the payload carries

`session_id`, `session_name`, `cwd`, `workspace.{current_dir,project_dir,git_worktree}`,
`model.{id,display_name}`, `version`, `output_style`, `cost.{total_cost_usd,total_duration_ms,
total_lines_added,total_lines_removed}`, `exceeds_200k_tokens`, and:

- `current_usage.{input,output,cache_creation,cache_read}_tokens`
- `context_window.{used_percentage,remaining_percentage,context_window_size,total_input_tokens,total_output_tokens}`

`context_window` is sent **only when a window was actually declared**. A script that divides by a
made-up size draws a confident wrong bar, which is worse than a bar that does not draw.

`rate_limits` is deliberately absent. It describes an Anthropic plan's quota, which has no meaning
behind a proxy or another provider — and inventing it would break the same rule that keeps `cost`
quiet on an unpriced model.

## Two differences from Claude Code

**It is not on the draw path.** The command runs on its own interval and the line renders whatever
it last returned, so a slow script makes the value stale rather than making the interface stutter.
A failing run leaves the last good value in place: a statusline that empties itself because a script
had a bad second is worse than one that is briefly behind.

**Its colours survive.** The SGR escapes are parsed rather than stripped:

| Written | Becomes |
| --- | --- |
| `38;2;r;g;b` | that exact colour |
| `38;5;n` | the 256-colour cube and grey ramp, exactly |
| `31`, `32`, `90`… | a **theme tone**, so a ported script still follows the theme you run |
| `1`, `2`, `48;…` | bold, dim, background |

A gradient bar from a script you tuned for Claude Code renders here cell for cell.

## Several rows

Claude Code statuslines print one row per `echo`. Every row is kept; pick one with `row`:

```jsonc
{
  "statusline": {
    "commands": { "mine": { "run": "~/.claude/statusline.sh" } },
    "lines": [
      { "surface": "bottom", "segments": [{ "type": "command", "name": "mine", "row": 0 }] },
      { "surface": "bottom", "segments": [{ "type": "command", "name": "mine", "row": 1 }] }
    ]
  }
}
```

## When to reach for this

For anything with a CLI that the bay does not know about: a cluster context, a ticket number, a
deploy state — or your proxy's real spend, which is better than any locally multiplied estimate.

For anything that needs the session, write [a module](/opencode-cockpit/status/modules/) instead.
It runs in-process, needs no subprocess, and is typed.
