/** Reading a segment's own settings out of its config entry, safely. */

import type { SegmentConfig } from "../config.ts"
import { template } from "../format.ts"
import type { Piece, Tone } from "../types.ts"

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
 * Returns `undefined` when no `format` was written, so the segment draws its default — which is
 * usually several runs in several colours. A format is one run in one tone: full control of the
 * words, at the cost of the colouring, which is the honest trade and worth saying out loud.
 */
export function formatted(
  config: SegmentConfig,
  values: Record<string, string | number>,
  tone: Tone = "muted",
): Piece | undefined {
  const shape = str(config, "format")
  if (shape === undefined) return undefined
  const text = template(shape, values)
  return text.length > 0 ? { text, tone } : undefined
}
