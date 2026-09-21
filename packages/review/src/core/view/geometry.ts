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

/** Columns the file list takes, clamped: paths are bounded, code is not. */
/** Narrow enough that a half-width pane keeps its list; paths elide to fit. */
export const MIN_LIST_COLUMNS = 18
export const MAX_LIST_COLUMNS = 40
export const LIST_SHARE = 0.3
/** Below this the diff column cannot hold a line of code, so the list gives up its space. */
export const MIN_DIFF_COLUMNS = 72
/** The divider, and a space either side of it. */
export const DIVIDER = 3

export interface Columns {
  list: number
  diff: number
}

export function splitColumns(width: number): Columns {
  const inner = Math.max(0, width - 2)
  const wanted = Math.min(MAX_LIST_COLUMNS, Math.max(MIN_LIST_COLUMNS, Math.floor(inner * LIST_SHARE)))
  /**
   * A narrow pane squeezes the list rather than losing it.
   *
   * Half of a wide terminal is around a hundred columns, where a share-based width left the diff a few
   * columns short of the minimum and the list vanished altogether — so the half-width pane, the one
   * people actually leave open beside the conversation, was the only view with no way to change file.
   */
  const room = inner - MIN_DIFF_COLUMNS - DIVIDER
  const list = room >= MIN_LIST_COLUMNS ? Math.min(wanted, room) : 0
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
