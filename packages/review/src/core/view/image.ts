/**
 * A binary file's card: what it is, what changed, a look at it, and the key that opens it.
 *
 *   PNG 2880×1800 · 807 KB → 789 KB
 *   2.56% of pixels changed · 601×221 at 1900,300
 *   [o] Open Both
 *
 *   before                       after
 *   ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀     ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀
 *
 * The picture is rows like every other row — runs of `▀` with an exact ink and an exact background —
 * so the pool's diffing, the grid test and the preview CLI all apply to it unchanged. It shows *where*
 * and roughly *what colour*; a 2880-pixel screenshot at fifty columns shows no legible text, which is
 * why `o` is on the card: the real viewer is the answer to "what".
 */

import { hintRuns } from "@opencode-cockpit/client/design"
import { pixelText, sameDimensions, summaryText } from "../image/describe.ts"
import type { ImageLook } from "../image/looks.ts"
import { type Cells, cellGrid, type Thumb, toCells } from "../image/pixels.ts"
import { decodable, formatName } from "../image/sniff.ts"
import type { BinaryChange, FileChange } from "../model/review.ts"
import { cell, clipRuns, type Row, type Run } from "./rows.ts"

/** Columns in from the card's edge: the code column's margin, near enough, without its gutters. */
const MARGIN = 2
/** Between the two pictures. */
const GAP = 3
/** The tallest a picture gets: enough to see a layout, not so tall a review becomes a gallery. */
export const PICTURE_ROWS = 14
/** Below this a picture says nothing, and the room goes to the words. */
const NARROWEST = 8

/** The pane's colour when none is known (the preview CLI's default theme). */
export const CANVAS = 0x1e1e2e

const blank = (width: number): Row => ({ runs: [{ text: " ".repeat(width) }] })

/** A line of words in the card, inset by the margin and exactly `width` wide. */
const line = (runs: Run[], width: number): Row => ({
  runs: clipRuns([{ text: " ".repeat(MARGIN) }, ...runs], width),
})

/** What opening it means, for the key on the card: one side has nothing to open on the other. */
export function openLabel(binary: BinaryChange): string {
  if (binary.before && binary.after) return "Open Both"
  return binary.after ? "Open" : "Open Old Version"
}

/** What sits where the picture would, when there is no picture. Undefined: say nothing. */
function lookLine(binary: BinaryChange, look: ImageLook | undefined): Run[] | undefined {
  if (look?.diff) {
    const lit = look.diff.changed > 0
    return [{ text: pixelText(look.diff), tone: lit ? "accent" : "muted", bold: lit }]
  }
  const images = [binary.before?.image, binary.after?.image]
  const decodes = images.some(decodable)
  if (look?.pending && decodes) return [{ text: "Comparing pixels…", tone: "muted" }]
  if (look?.problem) return [{ text: look.problem, tone: "muted" }]
  if (binary.before?.image && binary.after?.image && !sameDimensions(binary))
    return [{ text: "Resized — every pixel moved, so no pixel diff", tone: "muted" }]
  /** JPEG, WebP, BMP: described, not decoded. Said once, plainly, so a missing picture is not a bug. */
  const named = images.find((image) => image && !decodable(image))
  if (named)
    return [
      { text: `No preview for ${formatName(named)} here — the header is all that is read`, tone: "muted" },
    ]
  return undefined
}

/** One picture's row `row` as runs of identical cells merged: `▀▀▀` in one ink on one background. */
function cellRuns(cells: Cells | undefined, row: number, width: number): Run[] {
  if (!cells || row >= cells.rows) return [{ text: " ".repeat(width) }]
  const runs: Run[] = []
  let at = row * cells.cols
  const end = at + cells.cols
  while (at < end) {
    const top = cells.top[at] as number
    const bottom = cells.bottom[at] as number
    let length = 1
    while (at + length < end && cells.top[at + length] === top && cells.bottom[at + length] === bottom)
      length++
    runs.push({ text: "▀".repeat(length), color: top, background: bottom })
    at += length
  }
  if (cells.cols < width) runs.push({ text: " ".repeat(width - cells.cols) })
  return runs
}

/**
 * The pictures, side by side: before and after, or the one side an added or deleted file has.
 *
 * With a pixel diff, the after side shows what changed at full strength and the rest faded toward the
 * pane — the old side is drawn as it was, so the two still compare by eye.
 */
function pictureRows(look: ImageLook, width: number, canvas: number, paint: boolean): Row[] {
  const sides = [look.before, look.after]
  const shown = sides.filter((thumb): thumb is Thumb => thumb !== undefined)
  if (shown.length === 0) return []
  const room = width - MARGIN
  const panel =
    shown.length === 2 ? Math.floor((room - GAP) / 2) : Math.min(room, Math.floor((room - GAP) / 2))
  if (panel < NARROWEST) return []
  const mask =
    look.diff && look.diff.changed > 0 && look.diff.changed < look.diff.total ? look.diff.mask : undefined
  /** Measuring needs only the grid; the cells are worked out when drawing. */
  const grids = sides.map((thumb) =>
    thumb ? cellGrid(thumb.width, thumb.height, panel, PICTURE_ROWS) : undefined,
  )
  const height = Math.max(...grids.map((grid) => (grid ? grid.height / 2 : 0)))
  const cells = paint
    ? sides.map((thumb, index) =>
        thumb ? toCells(thumb, panel, PICTURE_ROWS, canvas, index === 1 ? mask : undefined) : undefined,
      )
    : [undefined, undefined]

  const rows: Row[] = []
  const caption = (text: string) => ({ text: cell(text, panel), tone: "muted" as const })
  const labels: Run[] =
    shown.length === 2
      ? [caption("before"), { text: " ".repeat(GAP) }, caption(mask ? "after · changes lit" : "after")]
      : [caption(look.before ? "before — deleted" : "after — new")]
  rows.push(line(labels, width))
  for (let row = 0; row < height; row++) {
    const runs: Run[] =
      shown.length === 2
        ? [...cellRuns(cells[0], row, panel), { text: " ".repeat(GAP) }, ...cellRuns(cells[1], row, panel)]
        : cellRuns(look.before ? cells[0] : cells[1], row, panel)
    rows.push(line(runs, width))
  }
  return rows
}

/**
 * The card's body for a binary file, under its heading and any note on the whole file.
 *
 * `paint` false measures: the same rows, the same count, without working out a single cell.
 */
export function binaryRows(
  file: FileChange,
  look: ImageLook | undefined,
  width: number,
  canvas = CANVAS,
  paint = true,
): Row[] {
  const binary = file.binary
  if (!binary || width <= 0) return []
  const rows: Row[] = [blank(width), line([{ text: summaryText(binary), tone: "text", bold: true }], width)]
  const said = lookLine(binary, look)
  if (said) rows.push(line(said, width))
  rows.push(line([...hintRuns({ key: "o", label: openLabel(binary) })], width))
  const pictures = look ? pictureRows(look, width, canvas, paint) : []
  if (pictures.length > 0) rows.push(blank(width), ...pictures)
  return rows
}

/** What a binary card's rows depend on beyond the file, for the row cache's key. */
export const lookKey = (look: ImageLook | undefined): string => (look ? String(look.stamp) : "")
