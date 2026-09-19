# @opencode-cockpit/status

A statusline for [OpenCode](https://opencode.ai) you can actually configure — declarative segments,
your own TypeScript, or the statusline script you already wrote for Claude Code.

```
 ▕████████┊┊░░░░┊░░░░┊▏ 39% │ ▁▂▃▅▆█ │ ▌94% cached │ +150 / -30 │ ▤ 3/7 todo │ ◷ 12m04s
```

Part of [opencode-cockpit](https://github.com/Codestz/opencode-cockpit). Install it on its own, or
get it with every other bay through the `opencode-cockpit` bundle.

---

## Install

```jsonc
// ~/.config/opencode/tui.json
{ "plugin": ["@opencode-cockpit/status"] }
```

That's enough. Without any configuration you get a line under the conversation carrying what
OpenCode does not already tell you.

## What it shows by default, and why it's so little

OpenCode's own furniture already carries a lot: its footer has the path, the branch and the token
count; its sidebar has the context percentage and the spend; its prompt has the agent and the model.

A statusline that repeats those buys you a second copy of something already on screen — on one
window the context percentage can end up drawn five times. So the default line is what the host
leaves out:

| Segment | Says |
| --- | --- |
| `session.status` | working, or `retry 2 in 5s` — OpenCode shows a spinner, not why it stalled |
| `git.diff` | `+150 / -30` for this session |
| `todo` | `3/7 todo`, and nothing once the list is done |
| `session.time` | `12m04s` |
| `diagnostics` | only when an LSP or MCP server is unhealthy |

Everything else is one line of config away — including the things the host shows, if you want them
in both places.

## Configuration

`~/.config/opencode-cockpit/config.json` for every project, `<project>/.cockpit.json` for one, and
the plugin entry itself beats both.

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

A segment is a built-in's name, or that name with settings. Unknown names are skipped rather than
fatal, so a config written against a newer version costs you a segment and not the line.

### Surfaces

Two, each with a job.

| `surface` | Where | Good for |
| --- | --- | --- |
| `bottom` | full-width line under the conversation | everything, when no sidebar is open |
| `sidebar` | the sidebar, stacked vertically by default | the time dimension: trends, composition |

Use `lines` for more than one at once:

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

Each line takes its own `separator`, `stack` (`horizontal` / `vertical`), `maxRows`, `icons` and
`paddingLeft` / `paddingRight` / `paddingTop` / `paddingBottom`. The padding defaults line each
surface up with OpenCode's own content.

### When the terminal is narrow

Segments carry a priority, and a line too wide for its surface drops the lowest-priority ones until
it fits. How full the context is survives a 60-column window; the version string does not. Set
`priority` on any segment to change what goes first. A vertical line drops by `maxRows` instead.

## Built-in segments

| Name | Shows | Settings |
| --- | --- | --- |
| `cwd` | folder, relative to the worktree | `maxWidth` |
| `git.branch` | current branch, dimmed on the default branch | |
| `git.diff` | `+150 / -30` for the session | |
| `model` | `claude-opus-5` | `full` |
| `context` | how full the window is | `style`: `percent` \| `bar` \| `gradient` \| `split`, `width`, `warnAt`, `dangerAt` |
| `tokens` | `78.5k tok` | |
| `cost` | session spend | `currency`, `showZero` |
| `todo` | `3/7 todo` | `showComplete` |
| `session.status` | working, or a retry and its countdown | |
| `session.time` | elapsed | `coarse` |
| `diagnostics` | unhealthy LSP and MCP servers | |
| `version` | this bay's version | |
| `text` | literal text | `value` |
| `command` | the output of a shell command | `name`, `row` |

Every segment takes `prefix`, `suffix`, `priority`, `color` (a tone name or `#rrggbb`) and `icon`.

**A segment with nothing to say says nothing.** `cost` hides itself where nobody declared prices
rather than reporting `$0.00`; `context` hides itself where nobody declared a window rather than
inventing a denominator; `diagnostics` is silent while everything is healthy. That rule matters
behind a proxy — see [Proxies](#proxies-litellm-and-friends).

## Your own segments, in TypeScript

The declarative config covers the usual line and a shell command covers anything with a CLI. Neither
can read the session and decide, or remember what it saw a minute ago. A module can.

```ts
// ~/.config/opencode-cockpit/statusline.ts
import type { CustomModule, StatusContext } from "@opencode-cockpit/status/segment"

export default {
  segments: {
    burn(ctx: StatusContext) {
      const session = ctx.session
      if (!session?.priced || session.cost <= 0) return undefined
      const minutes = (ctx.now - (session.startedAt ?? ctx.now)) / 60_000
      if (minutes < 1) return undefined
      const rate = session.cost / minutes
      return { text: `$${rate.toFixed(2)}/min`, tone: rate > 0.5 ? "warning" : "muted" }
    },
  },
} satisfies CustomModule
```

```jsonc
{
  "statusline": {
    "modules": ["~/.config/opencode-cockpit/statusline.ts"],
    "segments": ["burn", "git.diff"]
  }
}
```

The name is then usable anywhere a built-in is, and reusing a built-in's name replaces it. A segment
returns a string, a `{ text, tone }`, or `{ runs: [...] }` for several styles in one segment — an
icon in one colour, a figure in another, a bar whose cells are coloured by what fills them.

A module is handed the same snapshot the built-ins get and touches no OpenCode api, which makes a
custom segment exactly as testable as a built-in. It is loaded once and its segments are called on
every repaint, so it can keep history — which is how a sparkline or a rate is possible at all.

Returning `undefined` hides the segment. A segment that throws loses only its own place on the line.
A module that will not load raises a toast naming the file, rather than silently dropping segments.

**Worked examples** live in [`examples/`](./examples): `bottom.ts` is a complete line for a window
with no sidebar; `sidebar.ts` is a quiet column beside OpenCode's own Context block. Both are loaded
and asserted by the test suite, so neither can rot.

## Your Claude Code statusline

A shell command, fed the same JSON on stdin that Claude Code's `statusLine` hook sends:

```jsonc
{
  "statusline": {
    "commands": { "mine": { "run": "~/.claude/statusline.sh", "intervalMs": 2000 } },
    "segments": [{ "type": "command", "name": "mine" }]
  }
}
```

An existing script works unchanged. The payload carries `session_id`, `cwd`, `workspace`, `model`,
`version`, `cost.*` and — when a window was actually declared — `context_window.*` and
`current_usage.*`. `rate_limits` is deliberately absent: it describes an Anthropic plan's quota,
which has no meaning behind a proxy.

Two differences from Claude Code, both improvements:

- **It is not on the draw path.** The command runs on its own interval and the line renders whatever
  it last returned, so a slow script makes the value stale rather than making the interface stutter.
  A failing run leaves the last good value in place.
- **Its colours survive.** The SGR escapes are parsed rather than stripped: 24-bit `38;2;r;g;b` and
  the 256-colour cube become exact colours, and the basic sixteen become theme tones so a ported
  script still follows the theme you run. Multi-row scripts keep their rows — pick one with `row`.

## Proxies, LiteLLM and friends

Tokens always work: they come from the provider's response. Cost and the context percentage are
computed locally from your model catalogue, so behind a proxy they need declaring in OpenCode's own
config:

```jsonc
{
  "provider": {
    "litellm": {
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "https://llm.corp/v1" },
      "models": {
        "claude-opus-5": {
          "cost": { "input": 5, "output": 25, "cache_read": 0.5 },
          "limit": { "context": 200000, "output": 64000 }
        }
      }
    }
  }
}
```

Without them the `cost` and `context` segments stay silent instead of reporting `$0.00` and `0%`.
If your proxy knows the real spend — LiteLLM's `/spend` endpoints do — a `command` segment can read
it, which is better than any locally multiplied estimate.

## Requirements

OpenCode 1.18+ and Bun 1.3.5+.

## Licence

MIT
