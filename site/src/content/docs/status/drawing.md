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
    : { text: "█", tone: "panel" as const },
)
```

```ts
// background: nothing is drawn at all — the colour is the bar
runs.push({ text: " ".repeat(filled), bgTone: "accent" })
runs.push({ text: " ".repeat(width - filled), bgTone: "panel" })
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
