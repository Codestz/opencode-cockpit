/**
 * The arithmetic of the pane: how wide each half is, what fits, what scrolls.
 *
 * Numbers in, numbers out. Nothing here knows what a review is — which is what makes the awkward
 * widths cheap to check, and why the half-width pane's vanishing file list was found by a test that
 * calls `splitColumns` with seven numbers rather than by opening a terminal.
 */

import type { Fill, Row } from "./rows.ts"
import { rowWidth } from "./rows.ts"

/** Rows above the list: the summary bar and its rule. */
export const HEADER_ROWS = 2
/** Rows below it: the rule and the key hints. */
export const FOOTER_ROWS = 2

/**
 * The narrowest the file list may be: enough for `…ex.tsx` to be `index.tsx` again.
 *
 * It was 18 here and 24 in a second copy nobody read, and at 18 to 23 columns a half-width pane cut
 * `index.tsx` to `…ex.tsx` — the extension survives, the name you were looking for does not.
 */
export const MIN_LIST_COLUMNS = 26
/** The widest it is worth making one: past this, extra columns are spent on trailing whitespace. */
export const MAX_LIST_COLUMNS = 40
/**
 * Below this the diff column cannot hold a line of code, so the list gives up its space.
 *
 * Lowered from 72 by the eight columns the list's minimum rose, so two columns still start at exactly
 * the pane width they always did: the half-width pane keeps its list, and the list keeps its names.
 */
export const MIN_DIFF_COLUMNS = 64
/** The divider, and a space either side of it. */
export const DIVIDER = 3

export interface Columns {
  list: number
  diff: number
}

/**
 * How the room is split between the file list and the diff.
 *
 * `wanted` is what the list's own rows need — its longest name, indent and counts — so a review of
 * three short names does not spend forty columns of code on trailing space, and a deep one gets the
 * room to say which file is which. Clamped either way: paths are bounded, code is not.
 */
export function splitColumns(width: number, wanted: number = MAX_LIST_COLUMNS): Columns {
  const inner = Math.max(0, width - 2)
  const asked = Math.min(MAX_LIST_COLUMNS, Math.max(MIN_LIST_COLUMNS, wanted))
  /**
   * A narrow pane squeezes the list rather than losing it.
   *
   * Half of a wide terminal is around a hundred columns, where a share-based width left the diff a few
   * columns short of the minimum and the list vanished altogether — so the half-width pane, the one
   * people actually leave open beside the conversation, was the only view with no way to change file.
   */
  const room = inner - MIN_DIFF_COLUMNS - DIVIDER
  const list = room >= MIN_LIST_COLUMNS ? Math.min(asked, room) : 0
  return { list, diff: list === 0 ? inner : inner - list - DIVIDER }
}

/** Everything on screen, as rows, for a viewport of this size. */
/**
 * The gutter down each side of the pane.
 *
 * Shell gets this from the box model — `paddingLeft`, `paddingRight` on a real nested box. This pane
 * paints a flat list of rows into a text pool, which is the only way a slot surface updates at all,
 * so every space has to be a character somebody emits. Emitted here, once, rather than remembered by
 * five different row builders.
 */
export const GUTTER = 1

/**
 * Puts the gutter on a row and pads it out to the full width, so a fill reaches both edges.
 *
 * Without the padding a tinted row stopped where its text stopped, leaving a ragged right edge down
 * the diff wherever lines were short.
 */
export const inset = (row: Row, width: number, fill: Fill = "none"): Row => {
  const slack = Math.max(0, width - GUTTER * 2 - rowWidth(row))
  return {
    ...row,
    runs: [
      { text: " ".repeat(GUTTER), fill },
      ...row.runs,
      ...(slack > 0 ? [{ text: " ".repeat(slack), fill }] : []),
      { text: " ".repeat(GUTTER), fill },
    ],
  }
}

/** The visible slice, clamped so scrolling can never run off either end. */
export function window(rows: Row[], scroll: number, height: number): Row[] {
  const start = Math.max(0, Math.min(scroll, Math.max(0, rows.length - height)))
  return rows.slice(start, start + height)
}
