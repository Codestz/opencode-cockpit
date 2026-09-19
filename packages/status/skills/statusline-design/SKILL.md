---
name: statusline-design
description: Designing or editing an opencode-cockpit statusline — a bottom line or a sidebar column, its config, or a TypeScript segment module. Use when a request mentions the statusline, a segment, .cockpit.json's statusline section, or a module importing @opencode-cockpit/status/segment.
---

# Designing a statusline

A statusline is a **visual artifact judged in a terminal**. The failure mode this skill exists to
prevent is designing it blind: editing TypeScript, restarting OpenCode, and scoring the result from
a sentence. One sidebar took about twenty restarts and five rejected iterations that way, and three
of the rejections were glyph choices that read completely differently on screen than they do in
prose.

## Look at it before you ship it

```sh
bunx @opencode-cockpit/status preview --watch          # redraws on every save
bunx @opencode-cockpit/status preview --state full     # one state
bunx @opencode-cockpit/status preview --debug          # mark segments that drew nothing
```

The preview draws the real segments against sample sessions, in this terminal, with no OpenCode
involved. **Use it after every change.** If a design decision cannot be checked in the preview, it
has not been checked.

Before writing code for anything visual, **paste an ASCII mock and ask**. A mock costs a line; a
wrong reading of one ambiguous word costs two iterations. "Make it taller" once meant "make the bar
look solid", and the two interpretations share no code.

## Rules with reasons

| Rule | Why |
| --- | --- |
| **Never repeat what OpenCode already shows.** Its footer has path, branch, token total, spend; its prompt has agent and model. | Configured carelessly the same percentage lands on screen five times. The exception: a *better instrument* for the same fact — a bar you read without looking is not a second copy of `78.5K (39%)`. |
| **A segment with nothing to say says nothing.** | `cost` hides where no prices are declared rather than printing `$0.00`; `context` hides with no declared window rather than inventing a denominator. A confident wrong number is worse than an absent one. |
| **No walls of zeroes on a fresh session.** Check the `fresh` and `empty` fixtures. | Most designs look right mid-session and read as broken before the first reply. |
| **Every number gets a word.** Colour may repeat the meaning, never carry it alone. | A row distinguished only by colour is unreadable: "I read `mix` and I don't understand the colours." |
| **Labels in a fixed-width column, values after.** | Alignment is what makes a column read as designed rather than as output. |
| **Bars are solid.** Filled cells `█` coloured by level; the empty track is `█` in `panel` tone. | `░` reads as floating gaps and `─` reads as `-----`. Both were rejected on sight. Swapping one rejected glyph for another is not iteration. |
| **Single-width glyphs only.** | An emoji is two cells in most terminals and one in a few — exactly what shears a fixed-width line. |
| **Prefer a coloured rule `▌` to a filled pill.** | A filled block must be as wide as its text, so a short label leaves a slab of colour and an empty one leaves an empty box. |
| **Prefer a figure to a moving picture.** | A sparkline redraws its shape every second; movement in peripheral vision is the one thing a statusline must not do. `+1.2%/min · 48m left` changes digits and nothing else. |
| **No section headings above optional rows.** | A heading cannot know whether the rows under it will draw, so `SPEND` strands itself above nothing on an unpriced model. Self-label the rows instead. |
| **Emphasis is a bonus, never the meaning.** Bold, italic and underline are `<b>`, `<i>`, `<u>` markup — and a terminal with no bold face draws bold identically to plain. | Colour and background always render; weight may not. There is no strikethrough or inverse at all. |
| **Colours come from tones, not hexes.** `text muted accent success warning error info background panel border` | A literal ignores the user's theme, which is the first thing that makes a plugin look bolted on. Use a hex only where the exact colour *is* the meaning. |
| **Say what a number means in the word, not the docs.** `cache` is cache reads, `write` is cache writes, `in` is fresh prompt tokens, `out` is output plus reasoning. | Read and write are not in and out; a reader who has to learn your mapping will misread it. |

## The renderer's contract

- One segment draws **one row**, unless it returns an **array** of pieces — then each element is a
  row of its own. (Arrays used to be silently dropped; they work now.)
- A segment returns a string, `{ text, tone, color }`, `{ runs: [...] }`, an array of those, or
  `undefined` to say nothing.
- A run takes `tone`, `color`, `bg`, `bgTone`, `bold`, `dim`, `italic`, `underline`.
- **A track drawn in `panel` tone is invisible** on most themes — it is the panel's own colour.
  Use `border`.
- A **column** keeps at most `maxRows` rows (default 8) — **count your rows and raise it**, or the
  extras vanish. The preview prints `↳ N dropped` when this happens.
- A **line** drops the lowest-priority segments until it fits the width.
- A segment that throws loses only its own row. A module that fails to load raises a toast naming
  the file.

## Where everything lives

| What | Where |
| --- | --- |
| Settings, every project | `~/.config/opencode-cockpit/config.json` |
| Settings, one project | `<project>/.cockpit.json` |
| Modules | anywhere — `~/.config/opencode-cockpit/modules/` needs no `node_modules` beside it |
| Which plugins load | `~/.config/opencode/tui.json` |

## Turning OpenCode's own blocks off

Each block of the host's sidebar is an internal plugin, and `tui.json` disables any of them:

```jsonc
{ "plugin": ["opencode-cockpit"], "plugin_enabled": { "internal:sidebar-context": false } }
```

`internal:sidebar-{context,files,todo,lsp,mcp,footer}`, `internal:home-{footer,tips}`,
`internal:notifications`. **A sidebar meant to replace the Context block must carry what that block
carried** — percentage, token total, spend — or the user ends up with less than before.

The footer under the prompt is core UI: it cannot be hidden. Design around it.

## Start simple

Most people want a good line, not a composition exercise. Begin with the built-ins and a `format`
string; reach for a module only when the answer needs the session read, decided on, or remembered
across ticks — a rate, a trend, a budget from a file. Reach for a shell `command` for anything a CLI
already prints; do not reimplement the shell as a segment.
