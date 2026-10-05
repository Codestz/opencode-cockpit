/** Reading a segment's own settings out of its config entry, safely. */

import type { SegmentConfig } from "../config/index.ts"
import type { Piece, Run, Tone } from "../types.ts"

export function num(config: SegmentConfig, key: string, fallback: number): number {
  const value = config[key]
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

export function str(config: SegmentConfig, key: string): string | undefined {
  const value = config[key]
  return typeof value === "string" ? value : undefined
}

/**
 * A segment's own shape, when the config asked for one.
 *
 * Returns `undefined` when no `format` was written, so the segment draws its default. A format's
 * words are a label and its placeholders are figures, so they are drawn as every default reads: the
 * words muted, the figures in the text colour. `tk 85.2k` used to be one run in one colour — and the
 * default line gave each token figure a colour of its own, so three greens meant three things and
 * colour was doing a label's job (docs/building/design-system.md). A `color` on the segment still
 * paints all of it, because a colour you chose is a decision, not a default.
 */
export function formatted(
  config: SegmentConfig,
  values: Record<string, string | number>,
  tone: Tone = "muted",
): Piece | undefined {
  const shape = str(config, "format")
  if (shape === undefined) return undefined
  const runs: Run[] = []
  let at = 0
  /**
   * A format whose every figure is zero says nothing, so it draws nothing: `cache 0` on a session
   * with no prompt cache is a label and an absence. Silence is the rule (docs/building/design-system.md).
   * An empty piece rather than `undefined`, which would fall back to the segment's own shape.
   */
  const figures = [...shape.matchAll(/\{(\w+)\}/g)].flatMap(([, name = ""]) =>
    name in values ? [values[name]] : [],
  )
  if (figures.length > 0 && figures.every((value) => Number(value) === 0)) return { runs: [] }
  for (const found of shape.matchAll(/\{(\w+)\}/g)) {
    const [whole, name = ""] = found
    const start = found.index ?? 0
    if (start > at) runs.push({ text: shape.slice(at, start), tone })
    runs.push(name in values ? { text: String(values[name]), tone: "text" } : { text: whole, tone })
    at = start + whole.length
  }
  if (at < shape.length) runs.push({ text: shape.slice(at), tone })
  return runs.some((run) => run.text.length > 0) ? { runs } : undefined
}
