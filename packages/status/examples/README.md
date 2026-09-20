# Examples

Start with a **preset** — a whole line by name, built-ins only, nothing to install:

```jsonc
// ~/.config/opencode-cockpit/config.json
{ "statusline": { "preset": "default" } }
```

| Preset | Surface | What you get |
| --- | --- | --- |
| `minimal` | bottom | how full the context is, and what changed |
| `default` | bottom | the bar, where the tokens went, what changed, how long |
| `detailed` | bottom | everything the built-ins know, for a wide window |
| `sidebar` | sidebar | a quiet column beside OpenCode's own blocks |

Anything you write beside a preset wins, so it is a starting point rather than a mode:

```jsonc
{ "statusline": { "preset": "default", "separator": "  " } }
```

## When a preset is not enough

These are modules — TypeScript you copy and cut. Point `modules` at one and use its segments by
name. Every one is loaded and asserted by the test suite, so none of them can rot.

| File | For | Segments |
| --- | --- | --- |
| [`bottom.ts`](./bottom.ts) | the whole statusline on one line, no sidebar open | `bar` `filling` `rate` `cached` `tokens` |
| [`sidebar.ts`](./sidebar.ts) | a small column **beside** OpenCode's Context block | `bar` `split` `changes` |
| [`sidebar-full.ts`](./sidebar-full.ts) | a column that **replaces** that block — turn it off with `plugin_enabled` | `bar` `window` `cached` `spend` `elapsed` `changes` `todo` |
| [`sidebar-budget.ts`](./sidebar-budget.ts) | a column as a **table**: fixed label gutter, one bar, a proxy's budget, the branch diff | `title` `bar` `tokens` `in` `out` `cache` `write` `sep` `spend` `avail` `git` |
| [`gallery.ts`](./gallery.ts) | not a statusline — every technique the renderer can draw, labelled | all of them |

```jsonc
{
  "statusline": {
    "modules": ["~/.config/opencode-cockpit/modules/bottom.ts"],
    "surface": "bottom",
    "segments": ["bar", "filling", "rate", "cached", "session.diff", "session.time"]
  }
}
```

## Look at it before you ship it

```sh
bunx @opencode-cockpit/status preview --watch            # redraws on every save
bunx @opencode-cockpit/status preview --state fresh      # before the first reply
bunx @opencode-cockpit/status preview --debug            # mark segments that drew nothing
bunx @opencode-cockpit/status preview --module examples/gallery.ts
```

The six sample sessions are the states a design gets wrong: `fresh` (no model, no tokens — most
designs render a wall of zeroes), `working`, `full`, `unpriced` (behind a proxy, nothing declared),
`retrying`, and `empty`.

The taste rules this bay learned the expensive way live in
[`../skills/statusline-design/`](../skills/statusline-design/SKILL.md).
