---
title: What you can draw
description: Every technique the renderer offers — bars, markers, dividers, emphasis — and the code for each.
---

A segment returns styled runs of text, so "what can I draw?" has a finite answer. This is that
answer, with the code for each row.

It is a terminal, not a browser: there is no DOM, no images, no borders. What there *is* — and it
is more than it sounds — is **truecolor foreground and background**, bold, dim, and alignment. Most
of the design space is block glyphs and colour.

Run the catalogue yourself, and copy the row you want:

```sh
bunx @opencode-cockpit/status preview --module examples/gallery.ts --state working
```

## Bars

| Style | Reads as | When |
| --- | --- | --- |
| **solid** | `▕████████░░░░░░▏` with a solid dark track | the safe default — no gaps, no dashes |
| **gradient** | each filled cell coloured by its own level | a capacity you want read at a glance |
| **fine** | eighths, `██████▊` | a short bar that must not report in jumps |
| **split** | one bar, coloured by what fills it | a quantity made of parts |
| **steps** | `▮▮▮▮▯▯▯▯▯▯` | a count, not a proportion |
| **background** | spaces painted with `bgTone` | the chunkiest of all, and text can sit on it |

```ts
// solid: the fill and the track are the same glyph, so there are no gaps to read as holes
const runs = Array.from({ length: 16 }, (_, cell) =>
  cell < filled
    ? { text: "█", tone: "accent" as const }
    : { text: "█", tone: "border" as const },
)
```

```ts
// background: nothing is drawn at all — the colour is the bar
runs.push({ text: " ".repeat(filled), bgTone: "accent" })
runs.push({ text: " ".repeat(width - filled), bgTone: "border" })
```

**Avoid `░` and `─` as a track.** `░` reads as floating gaps on a dark theme and `─` reads as
`-----`. Both look broken beside a solid fill.

## Markers, dividers, emphasis

```ts
{ text: "▌", tone: "success" }                          // a rule: one column, any label
{ text: "▪ ", tone: "warning" }                         // a dot
{ text: " chip ", tone: "background", bgTone: "info" }  // a filled chip
{ text: "──────", tone: "border", dim: true }           // a hairline between groups
{ text: "bold", tone: "text", bold: true }              // bold, dim, and
{ text: " inverse ", tone: "background", bgTone: "text" } // inverse, via background
```

Prefer a **rule** to a chip where the label can be empty: a chip has to be as wide as its text, so
an empty one is an empty box.

## Tones

`text` · `muted` · `accent` · `success` · `warning` · `error` · `info` — and `background`, `panel`,
`border` for drawing against the window's own surfaces.

Prefer a tone to a hex. A tone follows whatever theme the reader runs; a literal does not. Use a hex
only where the exact colour *is* the meaning.

## Several rows from one segment

Return an array. Each element is a row of its own — that is how a gauge, a table, or a row per
service is built.

```ts
rows(ctx: StatusContext): Piece[] {
  return [
    { text: "one segment," },
    { text: "three rows," },
    { text: "returned as an array" },
  ]
}
```

A column keeps at most `maxRows` rows (default 8) — count them and raise it, or the extras vanish.
The preview prints `↳ N dropped` when that happens.

## Alignment

A fixed-width label column is what makes a column read as designed rather than as output:

```ts
function labelled(label: string, value: Run[]) {
  return { runs: [{ text: label.padEnd(11), tone: "muted", dim: true }, ...value] }
}
```

## Glyph traps

Two block glyphs behave differently from how they read in prose, and both cost a design pass to
find:

- `▕` and `▏` are **eighth-blocks**, not brackets. Their ink sits hard against one edge of the cell,
  so `▕████▏` as end caps indents the row by most of a column — the bar stops lining up with the
  labels above and below it. Caps are worth it on a line, where nothing has to align; in a column,
  leave them off and let the dark track show the bar's extent.
- `░` and `▒` read as *floating gaps*, not as an empty track. A solid `█` in the `border` tone is
  the track — and it must be `border`, because `panel` is the colour of the panel it sits on and
  therefore invisible.

## Let an agent draw it

Type **`/statusline`** in OpenCode. It draws nothing: it hands the agent already in your session a
brief carrying what it cannot look up — which config file this project reads, what is drawing right
now, your modules and any that failed to load, the preset and segment names — and ends by asking
what you want it to show.

The rules this bay learned the expensive way also ship **as a skill** inside the package, at
`skills/statusline-design/`. Copy it in and the agent picks up the taste as well as the api:

```sh
# Claude Code, for this project or for every project
mkdir -p .claude/skills
cp -r node_modules/@opencode-cockpit/status/skills/statusline-design .claude/skills/
```

Its `description` fires on any request that mentions the statusline, a segment, or a module
importing `@opencode-cockpit/status/segment`. What it carries is the taste, not the api: look at the
thing before shipping it, `preview --watch` instead of restarting OpenCode, the six sample states a
design gets wrong, the glyph traps above, and the rule that a number printed twice in one column is
the thing the eye catches on.

It is a plain Markdown file — worth reading yourself even if no agent ever loads it.
