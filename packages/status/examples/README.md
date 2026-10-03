# Examples

Start with a **preset** — a whole line by name, built-ins only, nothing to install:

```jsonc
// ~/.config/opencode-cockpit/config.json
{ "status": { "preset": "default" } }
```

| Preset | Surface | What you get |
| --- | --- | --- |
| `sidebar` | sidebar | a table: the window, where the tokens went, a proxy's budget, the branch's diff — the default |
| `minimal` | bottom | how full the context is, and what changed |
| `default` | bottom | the bar, where the tokens went, what changed, how long |
| `detailed` | bottom | everything the built-ins know, for a wide window |

Anything you write beside a preset wins, so it is a starting point rather than a mode:

```jsonc
{ "status": { "preset": "default", "separator": "  " } }
```

## When a preset is not enough

These are modules — TypeScript you copy and cut. Point `modules` at one and use its segments by
name. Every one is loaded and asserted by the test suite, so none of them can rot.

| File | For | Segments |
| --- | --- | --- |
| [`bottom.ts`](./bottom.ts) | the whole statusline on one line, no sidebar open | `bar` `filling` `rate` `cached` `tokens` |
| [`gallery.ts`](./gallery.ts) | not a statusline — every technique the renderer can draw, labelled | all of them |

```jsonc
{
  "status": {
    "modules": ["~/.config/opencode-cockpit/modules/bottom.ts"],
    "surface": "bottom",
    "segments": ["bar", "filling", "rate", "cached", "session.diff", "session.time"]
  }
}
```

The sidebar examples (`sidebar.ts`, `sidebar-full.ts`, `sidebar-budget.ts`) became the `sidebar`
preset in 0.9; its rows — `title`, `in`, `out`, `cache`, `write`, `sep`, `spend`, `avail`, `git` — are
built-ins. A config still pointing at one in this folder gets a `!` row saying so. A copy you made
elsewhere keeps working.

## Look at it before you ship it

```sh
bunx @opencode-cockpit/status preview --watch            # redraws on every save
bunx @opencode-cockpit/status preview --state fresh      # before the first reply
bunx @opencode-cockpit/status preview --debug            # mark segments that drew nothing
bunx @opencode-cockpit/status preview --proxy none       # as someone without a proxy sees it
bunx @opencode-cockpit/status preview --module examples/gallery.ts
```

The sample sessions are the states a design gets wrong: `fresh` (no model, no tokens — most designs
render a wall of zeroes), `working`, `busy`, `uncached`, `full`, `unpriced` (behind a proxy, nothing
declared), `retrying`, and `empty`.

The taste rules this bay learned the expensive way live in
[`../skills/statusline-design/`](../skills/statusline-design/SKILL.md).
