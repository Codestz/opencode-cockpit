/**
 * Every technique the renderer can draw, in one column, labelled.
 *
 * Not a statusline — a catalogue. A segment can only return styled runs of text, so "what can I
 * draw?" has a finite answer, and nobody can design against a list of segment names. Preview it
 * and copy the row you want:
 *
 *   bunx @opencode-cockpit/status preview --module <this file> --state working
 *
 * The bounds, so they are written down somewhere: a run carries a foreground colour (a theme tone
 * or a hex), a background, bold and dim. A segment draws one row, or an array of rows. There are
 * no borders, no images and no HTML — this is a terminal, and the freedom is in colour, in block
 * glyphs, and in alignment.
 */

import type { CustomModule, Piece, Run, StatusContext, Tone } from "@opencode-cockpit/status/segment"
import { contextRatio, gradient } from "@opencode-cockpit/status/segment"

const W = 16
const ratio = (ctx: StatusContext) => contextRatio(ctx.session) ?? 0.42

/** A label column, so a catalogue of rows reads as a table. */
function labelled(label: string, runs: Run[]): { runs: Run[] } {
  return { runs: [{ text: label.padEnd(11), tone: "muted", dim: true }, ...runs] }
}

/** Eighths, for a bar that resolves more than one cell at a time. */
const EIGHTHS = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"]

export default {
  segments: {
    /** Solid fill against a solid dark track. The safest bar: no gaps, no dashes. */
    barSolid(ctx: StatusContext) {
      const filled = Math.round(ratio(ctx) * W)
      return labelled("solid", [
        { text: "▕", tone: "border" },
        ...Array.from({ length: W }, (_, c) =>
          c < filled ? { text: "█", tone: "accent" as const } : { text: "█", tone: "border" as const },
        ),
        { text: "▏", tone: "border" },
      ])
    },

    /** The same bar, each filled cell coloured by the level it stands for. */
    barGradient(ctx: StatusContext) {
      const filled = Math.round(ratio(ctx) * W)
      return labelled("gradient", [
        { text: "▕", tone: "border" },
        ...Array.from({ length: W }, (_, c) =>
          c < filled ? { text: "█", color: gradient((c + 1) / W) } : { text: "█", tone: "border" as const },
        ),
        { text: "▏", tone: "border" },
      ])
    },

    /** Eighths resolve a fraction of a cell — worth it when the bar is short. */
    barFine(ctx: StatusContext) {
      const exact = ratio(ctx) * W
      const full = Math.floor(exact)
      const part = EIGHTHS[Math.floor((exact - full) * 8)] ?? ""
      return labelled("fine", [
        { text: "█".repeat(full), tone: "accent" },
        ...(part ? [{ text: part, tone: "accent" as const }] : []),
        { text: "█".repeat(Math.max(0, W - full - (part ? 1 : 0))), tone: "border" },
      ])
    },

    /** One bar coloured by what fills it, for a quantity made of parts. */
    barSplit(ctx: StatusContext) {
      const tokens = ctx.session?.tokens
      if (!tokens) return undefined
      const total = tokens.input + tokens.output + tokens.cache.read + tokens.cache.write
      const cells = (n: number) => Math.round((n / total) * W * ratio(ctx))
      return labelled("split", [
        { text: "█".repeat(cells(tokens.cache.read)), tone: "success" },
        { text: "█".repeat(cells(tokens.input)), tone: "info" },
        { text: "█".repeat(cells(tokens.output)), tone: "accent" },
        { text: "█".repeat(Math.max(0, W - Math.round(ratio(ctx) * W))), tone: "border" },
      ])
    },

    /** Discrete steps, when the number is a count rather than a proportion. */
    barSteps(ctx: StatusContext) {
      const filled = Math.round(ratio(ctx) * 10)
      return labelled("steps", [
        {
          text: Array.from({ length: 10 }, (_, c) => (c < filled ? "▮" : "▯")).join(""),
          tone: "accent",
        },
      ])
    },

    /** A bar drawn in background colour: taller-looking, and it keeps text on top of it. */
    barFilled(ctx: StatusContext) {
      const filled = Math.round(ratio(ctx) * W)
      return labelled("background", [
        { text: " ".repeat(filled), bgTone: "accent" },
        { text: " ".repeat(W - filled), bgTone: "panel" },
        { text: ` ${Math.round(ratio(ctx) * 100)}%`, tone: "muted" },
      ])
    },

    /**
     * Background *and* level colour: the chunkiest bar available, because nothing is drawn at
     * all — every cell is a painted space, so there is no glyph shape to read around.
     */
    barPaint(ctx: StatusContext) {
      const filled = Math.round(ratio(ctx) * W)
      return labelled("paint", [
        ...Array.from({ length: W }, (_, c) =>
          c < filled ? { text: " ", bg: gradient((c + 1) / W) } : { text: " ", bgTone: "border" as const },
        ),
        { text: ` ${Math.round(ratio(ctx) * 100)}%`, color: gradient(ratio(ctx)) },
      ])
    },

    /**
     * Braille packs two columns per cell, so a bar is twice the resolution in the same width.
     * It is also the smallest thing here — good beside text, poor as a headline.
     */
    barBraille(ctx: StatusContext) {
      const dots = Math.round(ratio(ctx) * W * 2)
      const cells = Array.from({ length: W }, (_, c) => {
        const left = dots > c * 2
        const right = dots > c * 2 + 1
        return left && right ? "⣿" : left ? "⡇" : "⠀"
      })
      return labelled("braille", [{ text: cells.join(""), tone: "accent" }])
    },

    /** A sparkline: only worth it for history, and only where movement is acceptable. */
    spark() {
      const points = [0.1, 0.18, 0.3, 0.28, 0.46, 0.52, 0.5, 0.71]
      return labelled("sparkline", [
        {
          text: points.map((p) => "▁▂▃▄▅▆▇█"[Math.min(7, Math.floor(p * 8))]).join(""),
          tone: "info",
        },
      ])
    },

    /** Markers: a rule reads at one column wide, a chip needs the width of its text. */
    markers() {
      return labelled("markers", [
        { text: "▌", tone: "success" },
        { text: "rule  ", tone: "muted" },
        { text: "▪ ", tone: "warning" },
        { text: "dot  ", tone: "muted" },
        { text: " chip ", tone: "background", bgTone: "info", bold: true },
      ])
    },

    /** Separating things: a hairline, an inline pipe, and plain space. */
    dividers() {
      return labelled("dividers", [
        { text: "──────", tone: "border", dim: true },
        { text: "  │  ", tone: "border" },
        { text: "· · ·", tone: "border", dim: true },
      ])
    },

    /**
     * Emphasis, and a warning: a terminal with no bold face draws bold exactly like plain, so
     * emphasis is a bonus and never the thing that carries the meaning. Colour always renders.
     */
    emphasis() {
      return labelled("emphasis", [
        { text: "bold ", tone: "text", bold: true },
        { text: "plain ", tone: "text" },
        { text: "dim ", tone: "muted", dim: true },
        { text: "ital", tone: "text", italic: true },
      ])
    },

    /** Underline, and the reliable way to make a run shout: give it a background. */
    emphasis2() {
      return labelled("", [
        { text: "underline ", tone: "text", underline: true },
        { text: " on a background ", tone: "background", bgTone: "accent" },
      ])
    },

    /** Every tone, so a design can be picked from what the theme actually provides. */
    /**
     * Every tone the theme provides, over two rows — one row is cut short in a sidebar column,
     * which is exactly the kind of thing you only find by looking at it.
     */
    tones(): Piece[] {
      const show = (names: readonly Tone[]) => names.map((tone) => ({ text: `${tone} `, tone }))
      return [
        labelled("tones", show(["text", "muted", "accent", "success"])),
        labelled("", show(["warning", "error", "info", "border"])),
      ]
    },

    /**
     * Several rows from one segment — a gauge, a table, a row per item. Returning an array is how
     * any repeated element is drawn; it is not one row containing newlines.
     */
    rows(ctx: StatusContext): Piece[] {
      const pct = Math.round(ratio(ctx) * 100)
      return [
        labelled("rows", [{ text: "one segment,", tone: "muted" }]),
        labelled("", [{ text: `three rows — ${pct}%`, tone: "muted" }]),
        labelled("", [{ text: "returned as an array", tone: "muted" }]),
      ]
    },
  },
} satisfies CustomModule
