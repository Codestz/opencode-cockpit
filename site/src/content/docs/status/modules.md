---
title: Your own segments
description: A statusline segment in TypeScript — typed, testable, and able to remember what it saw.
---

The declarative config covers the usual line, and a shell command covers anything with a CLI.
Neither can read the session and decide, or remember what it saw a minute ago. A module can.

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

The name is then usable anywhere a built-in is. Reusing a built-in's name replaces it. Paths take
`~`, an absolute path, or one relative to the project.

**A module does not need to live in a project.** `~/.config/opencode-cockpit/` is the natural home
for one, and nothing is installed next to it there — so the authoring import is resolved against the
installed bay rather than against the module's own folder. Without that, every example on this page
would fail for exactly the people following it.

## What a segment is handed

A `StatusContext`: a plain snapshot, not OpenCode's plugin api. That is what makes a custom segment
exactly as testable as a built-in — no host to stand up, no rendering to drive.

| Field | |
| --- | --- |
| `now` | the clock this frame was drawn against |
| `directory`, `worktree`, `home` | where you are |
| `branch`, `defaultBranch` | from OpenCode's own vcs state |
| `session` | id, title, status, retry, model, tokens, cost, `priced`, diff, todo, startedAt |
| `lsp`, `mcp` | service health |
| `commands` | what your shell commands last returned |
| `version`, `width` | the bay's version, and the room this line has |

Helpers come with it: `contextRatio`, `contextUsed`, `todoRemaining`, `unhealthy`, `gradient`,
`compact`, `money`, `duration`, `percent`, `bar`, `shortModel`, `shortPath`, `truncate`.

## What it may return

A string, a `{ text, tone }`, or `{ runs: [...] }` for several styles in one segment:

```ts
return {
  runs: [
    { text: "▌", tone: "success" },
    { text: "94% cached", tone: "muted" },
  ],
}
```

A run takes `tone`, `color` (`#rrggbb`), `bg`, `bgTone`, `bold` and `dim`. That is how a segment
carries an icon in one colour, a figure in another, and a bar whose cells are coloured by what
fills them.

**Prefer a coloured rule to a filled block.** A block has to be as wide as its text, so a short
label leaves a slab of colour with little in it — and a label that is sometimes empty leaves an
empty box with no explanation.

## Three things the contract guarantees

- **Returning `undefined` hides the segment.** Use it whenever the input is missing; a segment
  showing a confident wrong number is worse than one that is not there.
- **A segment that throws loses only its own place.** The rest of the line draws.
- **A module that will not load raises a toast naming the file** — its segments never disappear
  silently.

## Keeping history

A module is loaded once and its segments are called on every repaint, so it can accumulate:

```ts
const samples: number[] = []

export default {
  segments: {
    trend(ctx: StatusContext) {
      const ratio = contextRatio(ctx.session)
      if (ratio === undefined) return undefined
      samples.push(ratio)
      if (samples.length > 16) samples.shift()
      // ...draw a sparkline from samples
    },
  },
} satisfies CustomModule
```

This is the real argument for a module over config, more than styling is: a sparkline, a rate, a
direction — none of them exist in any single reading.

**Prefer a figure to a picture.** A sparkline redraws its whole shape every second, and movement in
the corner of your eye pulls attention away from what you are reading — the one thing a statusline
must not do. The same history reads better as a rate: `+1.2%/min · 48m left` changes its digits and
nothing else. If you do draw one, scale it to the range it has actually seen; against 0–100 a
session sitting at a steady 39% draws a flat wall of identical blocks.

## Worked examples

Two ship with the package, both loaded and asserted by the test suite so neither can rot:

- `examples/bottom.ts` — a complete line for a window with no sidebar: a capacity bar with a scale,
  a sparkline, spend per minute, cache share
- `examples/sidebar.ts` — a quiet column beside OpenCode's own Context block

Copy one and cut it down. They are written to be edited, not run verbatim.
