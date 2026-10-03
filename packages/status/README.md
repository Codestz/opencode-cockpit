# @opencode-cockpit/status

A statusline for [OpenCode](https://opencode.ai) you can actually configure: declarative segments,
your own TypeScript, or the statusline script you already wrote for Claude Code.

![The statusline under an OpenCode conversation: a context bar at 40%, the token total with its cache, input and output parts, what is uncommitted, elapsed time and todo progress](https://raw.githubusercontent.com/Codestz/opencode-cockpit/main/media/statusline.png)

Part of [opencode-cockpit](https://github.com/Codestz/opencode-cockpit). Install it on its own, or
get it with every other bay through the `opencode-cockpit` bundle.

---

## Install

```jsonc
// ~/.config/opencode/tui.json
{ "plugin": ["@opencode-cockpit/status"] }
```

That's enough. Without any configuration you get a table at the top of the sidebar carrying what
OpenCode's own Context block says, better. `/status-setup` has the agent change it with you.

## What it shows by default, and why

```
Context
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

The `sidebar` preset, and the default since 0.9: how full the window is as one solid bar, the tokens
broken into named rows with their share of it, a proxy's budget, and what is uncommitted — the work
not saved anywhere yet (`"against": "branch"` counts the whole branch instead). A retry shows under
the bar; the turn's own clock does not, OpenCode already shows one. Every number gets a word, in a fixed column so the
figures line up; colour is a level (calm, then the warning, then the error), never a label.

A row with nothing to say is not drawn: `write` with no cache writes, `spend` and `avail` with no
proxy writing a budget (see [Proxies](#proxies-litellm-and-friends)), `working` while nothing runs,
and a hairline with nothing on one side of it. The rows are built-ins — `title`, `context` with
`"style": "solid"`, `tokens` with `"style": "row"`, `in`, `out`, `cache`, `write`, `sep`, `spend`,
`avail`, `git` — so nothing is installed beside it.

It sits beside OpenCode's own Context block; to keep only one, see
[Replacing OpenCode's own sidebar blocks](#replacing-opencodes-own-sidebar-blocks).

### At the bottom instead

`{ "status": { "sidebar": false } }` — or `"surface": "bottom"` — draws the `default` line under
the conversation. OpenCode's own furniture already carries a lot: its footer has the path, the
branch and the token count; its sidebar has the context percentage and the spend; its prompt has the
agent and the model.

The bottom line repeats one of those on purpose — the token count and the percentage — because it
says them better: a bar you read without looking, with the total's parts beside it, is a different
instrument from `78.5K (39%)` in a corner. What stays out are the facts a second copy adds nothing
to: the path, the branch, the model, the spend.

| Segment | Says |
| --- | --- |
| `context` | `▐█████▉········▌ 43%` — how full the window is |
| `tokens` | `tk 85.2k │ cache 84.9k │ in 265 │ out 60` — the total, then what it is made of |
| `git.diff` | `+150 / -30` — what is uncommitted, from `git diff --shortstat HEAD` |
| `session.time` | `took 3m42s` — how long the last answer took; quiet while one is running |
| `todo` | `3/7 todo`, and nothing once the list is done |
| `session.status` | working, or `retry 2 in 5s` — OpenCode shows a spinner, not why it stalled |
| `diagnostics` | only when an LSP or MCP server is unhealthy |

Words are the labels, muted, and the figures are in the text colour; colour is kept for what it
signals — the bar's level, what was added and removed, a retry. A part that is zero, such as `cache`
on a provider with no prompt cache, is left out rather than drawn as `cache 0`.

Everything else is one line of config away — including the things the host shows, if you want them
in both places.

## A whole line by name

Composing fourteen segments is a design exercise; most people want a good line. A preset is
built-ins only — nothing to install, nothing to write:

```jsonc
{ "status": { "preset": "default" } }
```

| Preset | Surface | What you get |
| --- | --- | --- |
| `sidebar` | sidebar | the table above — the default |
| `minimal` | bottom | how full the context is, and what changed |
| `default` | bottom | the bar, where the tokens went, what changed, how long |
| `detailed` | bottom | everything the built-ins know, for a wide window |

Anything you write beside one wins, so it is a starting point and not a mode. A name that is not a
preset draws the surface's own line, with a `!` row above it naming the presets there are. See
[`examples/`](./examples) for the modules to reach for when a preset is not enough.

### Changing a row or two

`override` changes the preset's segments by name and keeps every other row, so the line goes on
following the preset. `false` drops a segment, a name swaps it in the same place, an object merges
into its settings:

```jsonc
{
  "status": {
    "override": {
      "git": { "against": "branch" },        // the branch's whole diff, not what is uncommitted
      "write": false,                         // no cache-write row
      "session.status": { "working": true }   // the turn's clock as well as a retry
    }
  }
}
```

A change applies to every segment of that name (`"sep": false` drops every hairline). `segments` is
still the whole list, replacing the preset's — write it only to build a different line; with both,
the override applies to `segments`. A line in `lines` takes its own `override`. A name that matches no
segment is a `!` row: `override "gti" matches no segment in the sidebar preset — did you mean "git"?`

## `/status-setup`

Type it, or just ask ("put the statusline at the bottom"), and the agent sets the line up with you
through the `status-setup` skill shipped in this package (`skills/status-setup/`): it reads what is
written now with `cockpit_settings`, fixes old names first, offers a preset to start from, asks what
you want, writes only what differs from the defaults, and checks the line in the preview that came
with your install. `/statusline`, its name until 0.9, still works for one release and says the new
name. Both come from Status's agent side (`@opencode-cockpit/status/server`), which the bundle
includes and the package's install line adds.

## Looking at it before a restart

```sh
bunx @opencode-cockpit/status preview --config ./status.json   # this file, read as OpenCode reads it
bunx @opencode-cockpit/status preview --surface sidebar        # draw there, whatever the file says
bunx @opencode-cockpit/status preview --debug --state fresh    # ✓name drew · ✗name drew nothing · ?name no such segment
```

`--config` reads the file through the same loader as the plugin — `preset`, `sidebarRows`,
`override`, the `!` rows and all — in place of your global config. `--config -` reads a candidate on
stdin as the file it is meant to become (`--as global`, the default, or `--as project`), with the
other file read beside it — how the `status-setup` skill looks at a change before writing it,
without a temporary file:

```sh
cat <<'EOF' | bunx @opencode-cockpit/status preview --config - --debug
{ "status": { "override": { "write": false } } }
EOF
```

The first line says what was read: `config: (stdin, as ~/.config/opencode-cockpit/config.json)`. The
sidebar is drawn 34 columns wide unless `--width` says otherwise; `--watch` redraws on every save.

## Configuration

The `status` section of `~/.config/opencode-cockpit/config.json` for every project, of
`<project>/.cockpit.json` for one, and the plugin entry itself beats both. Comments and trailing
commas are fine.

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

A segment is a built-in's name, or that name with settings. Unknown names are skipped rather than
fatal, so a config written against a newer version costs you a segment and not the line.

The keys every bay shares work here too: `enabled`, `sidebar` (`false` draws at the bottom),
`sidebarRows` (rows the column draws before the lowest-priority ones give way; the table's own is
14, any other column's 8). Where the block sits among the others is the top-level `sidebar` list —
`["status", "subagents", "shell", "trail", "trust"]` — and nowhere else.

**What is not read says so.** `"statusline"` (the section's name before 0.9), Status's keys at the
file's root, a bay-level `maxRows` (now `sidebarRows`) and `sidebarOrder` are no longer read; each is
a `!` row at the top of the column, `! settings: "statusline" is no longer read — run
/cockpit-setup`, until the file is fixed. So are a file that is not valid JSON, a top-level name
nothing reads, an entry in the `sidebar` list that is not a bay, a value of the wrong kind, and a
module that would not load.

### Surfaces

Two, each with a job.

| `surface` | Where | Good for |
| --- | --- | --- |
| `sidebar` | the sidebar, stacked vertically — the default | a table: every figure with its word |
| `bottom` | full-width line under the conversation | everything, when no sidebar is open |

Use `lines` for more than one at once:

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

Each line takes its own `separator`, `stack` (`horizontal` / `vertical`), `maxRows`, `icons` and
`paddingLeft` / `paddingRight` / `paddingTop` / `paddingBottom`. The padding defaults line each
surface up with OpenCode's own content.

### When the terminal is narrow

Segments carry a priority, and a line too wide for its surface drops the lowest-priority ones until
it fits. How full the context is survives a 60-column window; the version string does not. Set
`priority` on any segment to change what goes first. A column drops by `sidebarRows` (a line's own
`maxRows`) instead, and says how many with a `↳ N more` row.

## Built-in segments

| Name | Shows | Settings |
| --- | --- | --- |
| `cwd` | folder, relative to the worktree | `maxWidth` |
| `git.branch` | current branch, dimmed on the default branch | |
| `git.diff` | `+150 / -30` — what is uncommitted: `git diff --shortstat HEAD` | |
| `model` | `claude-opus-5` | `full` |
| `context` | how full the window is | `style`: `percent` \| `bar` \| `solid` \| `gradient` \| `split`, `width`, `warnAt`, `dangerAt` |
| `tokens` | `78.5k tok`; `tokens 85.2k · 43%` as a table row | `format`, `style`: `parts` \| `row` |
| `title` | `Context`, bold: a column's heading | `text` |
| `in` · `out` · `cache` · `write` | `cache  84.9k · 100%` — one part of the window and its share; nothing when zero | |
| `sep` | a hairline between groups, drawn only with a row on either side | `width` |
| `spend` · `avail` | `spend  $26.24`, `avail  $173.76 · 87% left` — a proxy's budget; nothing without one | `file` |
| `git` | `git    5f +312 -48` — what is uncommitted; `"against": "branch"` counts the branch against where it forked (`… vs main`) | |
| `cost` | session spend | `currency`, `showZero` |
| `todo` | `3/7 todo` | `showComplete` |
| `session.status` | `working 1m02s` since the prompt, or a retry and its countdown; `"working": false` (the sidebar preset) keeps only the retry | |
| `session.time` | the session's age, or with `of: "turn"` how long the last answer took | `of`: `session` \| `turn`, `coarse` |
| `diagnostics` | unhealthy LSP and MCP servers | |
| `version` | this bay's version | |
| `text` | literal text | `value` |
| `command` | the output of a shell command | `name`, `row` |

`session.time` has two clocks. Bare, it is how old the conversation is — from its creation, so one
reopened days later reads `2d 15h` — and a line you already wrote keeps that. `{ "type":
"session.time", "of": "turn" }` is what the built-in lines use: `took 3m42s` once an answer is
done, and nothing while one is running, because `session.status` is counting it from the same
prompt.

Every segment takes `prefix`, `suffix`, `priority`, `color` (a tone name or `#rrggbb`) and `icon`.

`git.diff` counts what is uncommitted — staged and unstaged together, against the last commit — so
you can check it by running the command yourself. Untracked files are left out: git cannot count
lines in a file it has never seen. The command runs only when a line carries the segment, at most
once every two seconds.

For the file count as well, pair a command with the `worktree` segment in `examples/bottom.ts`:

```jsonc
{
  "commands": { "tree": { "run": "git diff --shortstat", "intervalMs": 5000 } },
  "segments": [
    { "type": "git.diff", "prefix": "uncommitted " },
    { "type": "worktree", "prefix": "tree " }
  ]
}
```

`git.diff` also answers to `session.diff`, the name it had while the numbers came from OpenCode's own
file list.

**A segment with nothing to say says nothing.** `cost` hides itself where nobody declared prices
rather than reporting `$0.00`; `context` hides itself where nobody declared a window rather than
inventing a denominator; `diagnostics` is silent while everything is healthy. That rule matters
behind a proxy — see [Proxies](#proxies-litellm-and-friends).

## Replacing OpenCode's own sidebar blocks

Each block of OpenCode's sidebar is an internal plugin that its config can switch off. The names
differ by version:

```jsonc
// OpenCode 1 — ~/.config/opencode/tui.json
{
  "plugin": ["@opencode-cockpit/status"],
  "plugin_enabled": { "internal:sidebar-context": false }
}
```

```jsonc
// OpenCode 2 — ~/.config/opencode/cli.json
{ "plugins": ["@opencode-cockpit/status", "-opencode.sidebar.context"] }
```

That removes the host's own `Context / tokens / % used / spent` block, leaving the space to the
table — the honest way to avoid reading the same figure twice. `/cockpit-setup` offers it when Status
draws in the sidebar. On OpenCode 1 the same works for `internal:sidebar-files`, `-lsp`, `-mcp`,
`-footer`, and the home screen's `internal:home-footer` and `internal:home-tips`; OpenCode 2's sidebar
has no LSP or Todo block. Leave the Todo block on: nothing in Cockpit replaces it.

## What you can draw

A segment returns styled runs of text, so the design space is finite and worth seeing all at once.
`examples/gallery.ts` draws every technique in one column — solid, gradient, fine and split bars, a
bar painted in background colour, steps, a sparkline, rules, dots, chips, dividers, emphasis, every
tone, and one segment returning several rows:

```sh
bunx @opencode-cockpit/status preview --module examples/gallery.ts --state working
```

It is a terminal, not a browser — no DOM, no images, no borders. What there is: truecolor
foreground and background, bold, dim, and alignment. See
[What you can draw](https://codestz.github.io/opencode-cockpit/status/drawing/).

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
  "status": {
    "modules": ["~/.config/opencode-cockpit/statusline.ts"],
    "segments": ["burn", "git.diff"]
  }
}
```

The name is then usable anywhere a built-in is, and reusing a built-in's name replaces it. A segment
returns a string, a `{ text, tone }`, or `{ runs: [...] }` for several styles in one segment — an
icon in one colour, a figure in another, a bar whose cells are coloured by what fills them.

Paths take `~`, an absolute path, or one relative to the project. A module in your config directory
works even though nothing is installed next to it: the authoring import is resolved against the
installed bay rather than against the module's own folder.

A module is handed the same snapshot the built-ins get and touches no OpenCode api, which makes a
custom segment exactly as testable as a built-in. It is loaded once and its segments are called on
every repaint, so it can keep history — which is how a sparkline or a rate is possible at all.

Returning `undefined` hides the segment. A segment that throws loses only its own place on the line.
A module that will not load raises a toast naming the file and keeps a `!` row above the line,
rather than silently dropping segments.

**Worked examples** live in [`examples/`](./examples): `bottom.ts` is a complete line for a window
with no sidebar; `gallery.ts` draws every technique at once. Both are loaded and asserted by the
test suite, so neither can rot. The sidebar examples became the `sidebar` preset in 0.9.

## Your Claude Code statusline

A shell command, fed the same JSON on stdin that Claude Code's `statusLine` hook sends:

```jsonc
{
  "status": {
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
If your proxy knows the real spend, that is better than any locally multiplied estimate. The table's
`spend` and `avail` rows read it from a file: LiteLLM's IAP plugin writes `{ "baseline", "delta",
"cap" }` to `~/.cache/opencode-litellm-iap/spend.json`, and anything that writes the same shape will
do (`{ "type": "spend", "file": "~/elsewhere.json" }` points them at it). With no file they draw
nothing. A `command` segment can read anything else — LiteLLM's `/spend` endpoints, say.

```sh
bunx @opencode-cockpit/status preview --proxy ~/.cache/opencode-litellm-iap/spend.json
```

## Troubleshooting

```sh
npx opencode-cockpit@latest doctor
```

checks OpenCode, its config, Cockpit's logs and the daemon, and prints the fix for anything wrong —
on OpenCode 1 and 2, and when Cockpit will not load at all ([what it checks](https://codestz.github.io/opencode-cockpit/help/doctor/)).

Everything Cockpit does inside OpenCode goes to one file — which OpenCode loaded which bay, and every
error with its stack:

```sh
tail -50 ~/.cache/opencode-cockpit/cockpit.log
```

`COCKPIT_DEBUG=1 opencode` adds the detail. [Troubleshooting](https://codestz.github.io/opencode-cockpit/help/troubleshooting/) covers
the failures people hit and what to attach to an issue; [OpenCode 1 and 2](https://codestz.github.io/opencode-cockpit/start/opencode-versions/)
covers what differs between the two.

## Requirements

OpenCode 1.18+ or 2.0.15+, and Bun 1.3.5+.

## Licence

MIT
