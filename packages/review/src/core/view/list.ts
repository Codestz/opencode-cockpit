/**
 * The file list: a tree of what changed, and where the cursor is in it.
 *
 * Its own scroll and its own order. Navigation has to use *this* order and nothing else — walking the
 * change set's file order while the screen shows a grouped tree is why the cursor once appeared to
 * jump at random.
 */

import { type ChangeSet, isRead, type Review } from "../model/review.ts"
import { tallyRuns } from "./counts.ts"
import type { Fill, Row, Run } from "./rows.ts"
import { cellTail, clipRuns, rowWidth } from "./rows.ts"
import type { ViewState } from "./state.ts"
import { type TreeRow, treeRows } from "./tree.ts"

/**
 * The rows the cursor can sit on, in the order they are drawn.
 *
 * Navigation has to use *this* order and nothing else. Moving through the change set's own file order
 * while the screen shows a grouped tree is why the cursor appeared to jump at random: two orders, one
 * cursor.
 */
export function navigableRows(changes: ChangeSet, state: ViewState): TreeRow[] {
  return treeRows(
    changes.files.map((file) => file.path),
    state.collapsed ?? new Set(),
  )
}

/**
 * The column the additions and deletions line up in.
 *
 * As wide as the widest change in *this* review and no wider: a fixed column is either too small for
 * `+1234 −567`, which then overflows and takes the pane's right edge with it, or too wide for a
 * branch of one-line fixes — and in a narrow list those columns are names.
 */
const countsColumn = (changes: ChangeSet): number => {
  const widest = changes.files.reduce((most, file) => Math.max(most, rowWidth({ runs: tallyRuns(file) })), 0)
  return Math.min(10, Math.max(6, widest))
}

/** A folder's mark. Two columns, and no glyph that needs a font the terminal may not have. */
const MARK_COLUMNS = 2

/**
 * One column of indent per level, not two.
 *
 * A review of a real repository is six or seven levels deep before it reaches a file, and at two
 * columns a level that is most of a narrow pane spent on whitespace — names were being cut to nothing
 * to make room for the indent that was supposed to organise them.
 */
const STEP = 1

/**
 * How much of a list row is left for the name.
 *
 * Two columns in the margin, the indent, the folder mark, the counts, and one column of air at the
 * end. Written once because both kinds of row have to agree to the character: when they disagreed by
 * one, a row overflowed its column and the pane's right edge went ragged.
 */
const nameRoom = (width: number, indent: number, counts: number): number =>
  Math.max(1, width - 2 - indent - MARK_COLUMNS - counts - 1)

export function fileRows(changes: ChangeSet, review: Review, state: ViewState, width: number): Row[] {
  if (width <= 0) return []
  const byPath = new Map(changes.files.map((file) => [file.path, file]))
  const counts = countsColumn(changes)

  return navigableRows(changes, state).map((row) => {
    const indent = " ".repeat(row.depth * STEP)
    const here = row.path === state.cursor
    /**
     * The cursor is a bar in the margin, not a colour on the text.
     *
     * A selected row keeps its own colours — the file type badge, the green and red of its counts —
     * and says it is selected with one character and a faint band. Recolouring the row to show where
     * the cursor is throws away everything else the row was telling you.
     */
    const mark = (): Run => ({ text: here ? "▌" : " ", tone: "accent" })
    const band: Fill = here ? "selected" : "none"

    if (row.kind === "folder") {
      const count = `${row.files}`
      const icon = state.collapsed?.has(row.path) ? "▸ " : "▾ "
      const room = nameRoom(width, indent.length, counts)
      return {
        target: row.path,
        runs: [
          mark(),
          { text: " ", fill: band },
          { text: indent, fill: band },
          { text: icon, tone: "muted", fill: band },
          { text: cellTail(row.name, room), tone: "text", bold: here, fill: band },
          { text: count.padStart(counts), tone: "muted", fill: band },
          { text: " ", fill: band },
        ],
      }
    }

    const file = byPath.get(row.path)
    const showing = row.path === state.file
    const read = isRead(review, row.path)
    const tally = tallyRuns(file).map((run) => ({ ...run, fill: band }))
    /**
     * Right-aligned in its column, and never wider than it.
     *
     * The padding goes in front, so the numbers end where every other row's numbers end; a change too
     * big for the column is cut rather than allowed to push the row past the edge of the pane.
     */
    const used = rowWidth({ runs: tally })
    const numbers: Run[] =
      used >= counts
        ? clipRuns(tally, counts, band)
        : [{ text: " ".repeat(counts - used), fill: band }, ...tally]
    /** A file's name starts where a folder's does: in the columns the folder mark would occupy. */
    const room = nameRoom(width, indent.length, counts)
    return {
      target: row.path,
      runs: [
        mark(),
        /**
         * A tick when it has been read, and nothing at all when it has not — an unread marker on every
         * row is noise on the rows you have not got to yet, which is most of them.
         */
        { text: read ? "✓" : " ", tone: "success", fill: band },
        { text: indent, fill: band },
        { text: " ".repeat(MARK_COLUMNS), fill: band },
        {
          text: cellTail(row.name, room),
          tone: showing || here ? "text" : "muted",
          bold: showing,
          fill: band,
        },
        ...numbers,
        { text: " ", fill: band },
      ],
    }
  })
}

/**
 * Where the file list starts drawing.
 *
 * The scroll is its own state; this only clamps it to something that exists. Keeping the cursor in
 * view is the *cursor's* job, done when it moves — see `keepCursorVisible`.
 */
export function listScroll(changes: ChangeSet, state: ViewState, height: number): number {
  const rows = navigableRows(changes, state)
  const most = Math.max(0, rows.length - height)
  return Math.max(0, Math.min(state.listOffset ?? 0, most))
}

/**
 * The scroll that brings the cursor back into view, moving as little as possible.
 *
 * Only called when the cursor moves, so scrolling with the wheel leaves the cursor where it is and
 * moving the cursor with keys never jumps the view further than it has to.
 */
export function keepCursorVisible(changes: ChangeSet, state: ViewState, height: number): number {
  const rows = navigableRows(changes, state)
  const at = state.cursor ? rows.findIndex((row) => row.path === state.cursor) : 0
  const offset = listScroll(changes, state, height)
  if (at < 0) return offset
  if (at < offset) return at
  if (at > offset + height - 1) return at - height + 1
  return offset
}
