/**
 * A binary file's change, in words.
 *
 * `PNG 2880×1800 · 807 KB → 789 KB`, then `2.56% of pixels changed · 601×221 at 1900,300`. In order of
 * how often each is the whole answer (docs/opencode/images.md): did it change and how, how much and
 * where. Plain strings, so the card, the preview CLI and anything else that ever has to say it say the
 * same thing.
 */

import type { BinaryChange, BinarySide } from "../model/review.ts"
import type { PixelDiff } from "./pixels.ts"
import { formatName } from "./sniff.ts"

/** `512 B`, `12.3 KB`, `807 KB`, `13.5 MB`: three significant figures at most, in 1024s. */
export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ["KB", "MB", "GB"]
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  const shown = value >= 100 ? Math.round(value).toString() : value.toFixed(1)
  return `${shown} ${units[unit]}`
}

const dimensions = (side: BinarySide | undefined): string =>
  side?.image ? `${side.image.width}×${side.image.height}` : ""

const kind = (side: BinarySide | undefined): string => (side?.image ? formatName(side.image) : "binary")

/**
 * What the file is, and what happened to its size and shape.
 *
 *   PNG 2880×1800 · 807 KB → 789 KB          edited, same dimensions
 *   PNG 2880×1800 → 1440×900 · 807 KB → 220 KB
 *   PNG 640×400 → JPEG 640×400 · 91 KB → 40 KB
 *   PNG 2880×1800 · 807 KB                    added or deleted: the one side there is
 *   binary · 12.3 KB → 14.0 KB                not an image this bay can name
 */
export function summaryText(binary: BinaryChange): string {
  const { before, after } = binary
  const sizes = [before, after]
    .filter((side): side is BinarySide => side !== undefined)
    .map((side) => sizeText(side.size))
    .join(" → ")
  if (!before || !after) {
    const side = before ?? after
    return [kind(side), dimensions(side)].filter(Boolean).join(" ") + (sizes ? ` · ${sizes}` : "")
  }
  const was = [kind(before), dimensions(before)].filter(Boolean).join(" ")
  const now = [kind(after), dimensions(after)].filter(Boolean).join(" ")
  let shape: string
  if (was === now) shape = was
  else if (kind(before) === kind(after)) shape = `${was} → ${dimensions(after)}`
  else shape = `${was} → ${now}`
  return `${shape} · ${sizes}`
}

/** Whether both sides are images of one size — the only case a pixel percentage means anything. */
export const sameDimensions = (binary: BinaryChange): boolean =>
  binary.before?.image !== undefined &&
  binary.after?.image !== undefined &&
  binary.before.image.width === binary.after.image.width &&
  binary.before.image.height === binary.after.image.height

/** `2.56%`, `0.04%`, `<0.01%`, `100%`. */
export function percentText(changed: number, total: number): string {
  if (total === 0 || changed === 0) return "0%"
  const percent = (changed / total) * 100
  if (percent < 0.01) return "<0.01%"
  if (percent >= 99.995 && changed < total) return ">99.99%"
  if (changed === total) return "100%"
  return `${percent < 10 ? percent.toFixed(2) : percent.toFixed(1)}%`
}

/**
 * How much changed, and where: `2.56% of pixels changed · 601×221 at 1900,300`.
 *
 * Same pixels with different bytes is its own answer — the file was re-encoded or its metadata
 * changed, and the picture did not.
 */
export function pixelText(diff: PixelDiff): string {
  if (diff.changed === 0) return "Same pixels — only the encoding or metadata changed"
  const box = diff.box
  const where = box ? ` · ${box.width}×${box.height} at ${box.x},${box.y}` : ""
  return `${percentText(diff.changed, diff.total)} of pixels changed${where}`
}
