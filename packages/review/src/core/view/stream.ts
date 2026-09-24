/**
 * Every file in one scroll, the way a pull request reads.
 *
 * The diff pane used to show one file at a time, so reading a review was: finish a file, go back to
 * the list, pick the next one. A pull request is read top to bottom — each file under a heading you
 * can fold, viewed files folded out of the way — and this is that.
 *
 * **Virtualised.** Only the rows on screen are ever built. Every file's *height* is needed to know
 * where each one starts, and that is measured without syntax colouring (see `diffHeight`) and cached,
 * so a two-hundred-file review costs a count per file once, and a screenful of tokenised rows per
 * frame. Folded files cost a heading.
 *
 * Nothing here knows about OpenTUI or about ANSI.
 */

import { type ChangeSet, type FileChange, isRead, type Review, threadsFor } from "../model/review.ts"
import { tallyRuns } from "./counts.ts"
import { awayRows, diffHeight, diffRows, withCursor } from "./diff.ts"
import { cell, elidePath, type Row, type Run, rowWidth } from "./rows.ts"
import type { ViewState } from "./state.ts"
import { treeRows } from "./tree.ts"

/**
 * One file's stretch of the stream: its heading, the heading's lower edge, and — when open — its diff
 * and a blank row after it.
 */
export interface Segment {
  path: string
  /** First row of the heading, counted from the top of the stream. */
  start: number
  height: number
  open: boolean
  /** Undefined for a file with comments but no diff. */
  file?: FileChange
}

export interface Stream {
  segments: Segment[]
  total: number
}

/** Changed lines past which a file starts folded: a lockfile is not read line by line. */
export const LARGE_DIFF = 1500

/**
 * Whether a file's diff is showing.
 *
 * Open until marked viewed, like GitHub — reading a file and marking it is what folds it out of the
 * way. A hand-folded or hand-opened file stays how it was left, either way.
 */
export function isOpen(
  path: string,
  file: FileChange | undefined,
  review: Review,
  state: ViewState,
): boolean {
  if (state.folded?.has(path)) return false
  if (state.opened?.has(path)) return true
  if (isRead(review, path)) return false
  return !file || file.additions + file.deletions <= LARGE_DIFF
}

/**
 * The files in the order the list draws them — the tree's order, folders ignored — then the files
 * that have comments and no diff. Two orders for one set of files is how a cursor seems to jump.
 */
export function streamOrder(changes: ChangeSet, state: ViewState): string[] {
  const paths = treeRows(changes.files.map((file) => file.path))
    .filter((row) => row.kind === "file")
    .map((row) => row.path)
  return [...paths, ...(state.elsewhere ?? []).filter((path) => !paths.includes(path))]
}

export function streamOf(changes: ChangeSet, review: Review, state: ViewState, width: number): Stream {
  const byPath = new Map(changes.files.map((file) => [file.path, file]))
  const segments: Segment[] = []
  let start = 0
  for (const path of streamOrder(changes, state)) {
    const file = byPath.get(path)
    const open = isOpen(path, file, review, state)
    /** The builders' own first row is their heading; the card draws its own in its place. */
    const inner = innerWidth(width)
    const body = open
      ? Math.max(
          0,
          (file ? diffHeight(file, review, state, inner) : awayRows(path, review, state, inner).length) - 1,
        )
      : 0
    /** Open: heading, its lower edge, the diff, the bottom border, a gap. Folded: heading and a gap. */
    const height = open ? HEAD + body + TAIL : FOLDED
    segments.push({ path, start, height, open, ...(file ? { file } : {}) })
    start += height
  }
  return { segments, total: start }
}

/** The segment a stream row falls in. Binary search: a review can be long. */
export function segmentAt(stream: Stream, row: number): Segment | undefined {
  const { segments } = stream
  let low = 0
  let high = segments.length - 1
  while (low <= high) {
    const mid = (low + high) >> 1
    const segment = segments[mid] as Segment
    if (row < segment.start) high = mid - 1
    else if (row >= segment.start + segment.height) low = mid + 1
    else return segment
  }
  return undefined
}

/**
 * Where the view starts: the scroll you have, or — with none yet — the top of the file you opened.
 *
 * The last file's heading may reach the top of the pane, even when that leaves space below it:
 * opening the last file should put it where every other file goes, not wherever the end happens to
 * land.
 */
export function streamScroll(stream: Stream, state: ViewState, height: number): number {
  const wanted = state.scroll ?? stream.segments.find((segment) => segment.path === state.file)?.start ?? 0
  const last = stream.segments.at(-1)?.start ?? 0
  const most = Math.max(0, stream.total - height, last)
  return Math.max(0, Math.min(wanted, most))
}

/**
 * Each file is a card, the way GitHub draws a pull request:
 *
 *   ╭──────────────────────────────╮   the top border (folded: `╭▄▄▄╮`, the fill's own top edge)
 *   │▌ ▾ path       +3 −1  + note  │   the heading, filled inside the sides
 *   │▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀│   and half a row below it, so the text sits centred
 *   │ … the diff …                 │
 *   ╰──────────────────────────────╯
 *                                      a blank row before the next card
 *
 * Half blocks carry the heading's top and bottom edges, because a terminal cannot clip half a cell:
 * a border line sits mid-cell, so a filled row beside it leaves a band of the pane's colour, and
 * filling the border's own cell spills colour outside the card. `▄` in the top border's row starts
 * the fill exactly where the rounded corners' line runs. Folded, the lower half-row is the bottom
 * border (`╰▀▀▀╯`), and the file is its heading alone.
 */
const HEAD = 3
/** The heading's own row. */
const TITLE = 1
/** A folded file: top edge, heading, bottom edge, gap. */
const FOLDED = 4
const TAIL = 2
const innerWidth = (width: number) => Math.max(1, width - 2)

/** Right-aligned on the heading, so they sit where a pointer can find them in every width. */
export const VIEWED = " [✓] viewed "
export const UNVIEWED = " [ ] viewed "
export const NOTE = " + note "
/** Below this the heading is for the name; the buttons go and the keys still work. */
const BUTTONS_FROM = 48

/** What a click on a heading does, by the column it landed on inside the diff pane. */
export function headerZone(width: number, x: number): "viewed" | "note" | "fold" {
  const inner = innerWidth(width)
  if (inner < BUTTONS_FROM) return "fold"
  /** Inside the card: its left edge is the first column. */
  const at = x - 1
  if (at >= inner - VIEWED.length && at < inner) return "viewed"
  if (at >= inner - VIEWED.length - NOTE.length && at < inner) return "note"
  return "fold"
}

/**
 * A file's heading bar: accent mark, fold mark, path, counts in their colours, its notes, and the two
 * buttons, filled to `inner` columns.
 */
export function headerRow(
  segment: Segment,
  review: Review,
  inner: number,
  current = false,
  onHeading = false,
): Row {
  const read = isRead(review, segment.path)
  const whole = threadsFor(review, segment.path).filter((each) => each.line === undefined)
  const notes = threadsFor(review, segment.path).length
  const tally: Run[] = [
    ...tallyRuns(segment.file).map((run) => ({ ...run, fill: "heading" as const })),
    { text: " ", fill: "heading" },
  ]
  const badge: Run[] =
    notes > 0 ? [{ text: ` ▐ ${notes} `, tone: "accent", bold: true, fill: "heading" }] : []
  const buttons: Run[] =
    inner >= BUTTONS_FROM
      ? [
          { text: NOTE, tone: "accent", fill: "heading" },
          read
            ? { text: VIEWED, tone: "success", bold: true, fill: "heading" }
            : { text: UNVIEWED, tone: "muted", fill: "heading" },
        ]
      : []
  const lead: Run[] = [
    { text: current ? "▌" : " ", tone: "accent", fill: "heading" },
    { text: " ", fill: "heading" },
    {
      text: segment.open ? "▾ " : "▸ ",
      tone: onHeading ? "accent" : "muted",
      bold: onHeading,
      fill: "heading",
    },
  ]
  const room = Math.max(1, inner - rowWidth({ runs: [...lead, ...tally, ...badge, ...buttons] }))
  return {
    file: segment.path,
    header: true,
    ...(whole[0] ? { target: whole[0].id } : {}),
    runs: [
      ...lead,
      {
        text: cell(elidePath(segment.path, room), room),
        tone: onHeading ? "accent" : read ? "muted" : "text",
        bold: !read || onHeading,
        fill: "heading",
      },
      ...tally,
      ...badge,
      ...buttons,
    ],
  }
}

/** A row inside the card, between its side borders. */
const inCard = (row: Row, segment: Segment, border: Run["tone"]): Row => ({
  ...row,
  file: segment.path,
  runs: [{ text: "│", tone: border }, ...row.runs, { text: "│", tone: border }],
})

/** One row of a segment, by its index inside it. `body` is the segment's built rows, when open. */
function segmentRow(
  segment: Segment,
  index: number,
  body: () => Row[],
  review: Review,
  width: number,
  state: ViewState,
): Row {
  const inner = innerWidth(width)
  const current = segment.path === state.file
  const border: Run["tone"] = current ? "accent" : "border"
  /** A row of the border with the heading's half-row edge between its corners or sides. */
  const edge = (left: string, glyph: "▄" | "▀", right: string): Row => ({
    file: segment.path,
    header: true,
    runs: [
      { text: left, tone: border },
      { text: glyph.repeat(inner), tone: "edge" },
      { text: right, tone: border },
    ],
  })
  /**
   * Open, the card needs its top border as a line, to match the sides and bottom it frames the diff
   * with. Folded, the heading is the whole card, and its half-block top edge is the border.
   */
  if (index === 0)
    return segment.open
      ? { file: segment.path, header: true, runs: [{ text: `╭${"─".repeat(inner)}╮`, tone: border }] }
      : edge("╭", "▄", "╮")
  if (index === TITLE) return titleRow(segment, review, width, state)
  if (index === segment.height - 1) return { file: segment.path, runs: [{ text: " ".repeat(width) }] }
  if (!segment.open) return edge("╰", "▀", "╯")
  if (index === 2) return edge("│", "▀", "│")
  if (index === segment.height - 2)
    return { file: segment.path, runs: [{ text: `╰${"─".repeat(inner)}╯`, tone: border }] }
  /** The builder's row `n` sits under the heading block; the cursor is drawn inside the border. */
  const row = body()[index - HEAD + 1] ?? { runs: [{ text: " ".repeat(inner) }] }
  const marked = current ? (withCursor([{ ...row, file: segment.path }], state)[0] ?? row) : row
  return inCard(marked, segment, border)
}

/** The heading row — shared by the card and the pinned copy at the top of the pane. */
function titleRow(segment: Segment, review: Review, width: number, state: ViewState): Row {
  const current = segment.path === state.file
  const onHeading = current && state.pane === "diff" && state.line === undefined
  return inCard(
    headerRow(segment, review, innerWidth(width), current, onHeading),
    segment,
    current ? "accent" : "border",
  )
}

/**
 * The rows on screen, and nothing else.
 *
 * The heading of the file you are inside stays pinned to the top row, the way GitHub's does: halfway
 * down a long diff, which file this is should not be a question.
 */
export function streamWindow(
  changes: ChangeSet,
  review: Review,
  state: ViewState,
  width: number,
  height: number,
): Row[] {
  if (width <= 0 || height <= 0) return []
  const stream = streamOf(changes, review, state, width)
  const scroll = streamScroll(stream, state, height)
  const inner = innerWidth(width)
  const rows: Row[] = []
  let segment = segmentAt(stream, scroll)
  let index = segment ? scroll - segment.start : 0
  /** Built once per segment on screen, not looked up once per row. */
  let built: Row[] | undefined
  const body = () => {
    if (built) return built
    const at = segment as Segment
    built = at.file ? diffRows(at.file, review, state, inner) : awayRows(at.path, review, state, inner)
    return built
  }
  while (segment && rows.length < height) {
    rows.push(segmentRow(segment, index, body, review, width, state))
    index++
    if (index >= segment.height) {
      segment = stream.segments[stream.segments.indexOf(segment) + 1]
      index = 0
      built = undefined
    }
  }
  const top = segmentAt(stream, scroll)
  if (top && scroll > top.start + TITLE && scroll < top.start + top.height - TAIL && rows.length > 0)
    rows[0] = titleRow(top, review, width, state)
  return rows
}

/**
 * The places the cursor can stand in a file, in order: its heading, then — when it is open — each
 * line of the new file the diff shows.
 */
export function stopsOf(
  segment: Segment,
  review: Review,
  state: ViewState,
  width: number,
): (number | undefined)[] {
  if (!segment.open || !segment.file) return [undefined]
  const lines = diffRows(segment.file, review, state, innerWidth(width))
    .map((row) => row.line)
    .filter((line): line is number => line !== undefined)
  return [undefined, ...lines]
}

/** The stream row the cursor is on, for keeping it in view. */
export function cursorRow(
  stream: Stream,
  review: Review,
  state: ViewState,
  width: number,
): number | undefined {
  const segment = stream.segments.find((each) => each.path === state.file)
  if (!segment) return undefined
  if (state.line === undefined || !segment.open || !segment.file) return segment.start + TITLE
  const at = diffRows(segment.file, review, state, innerWidth(width)).findIndex(
    (row) => row.line === state.line,
  )
  return at < 1 ? segment.start + TITLE : segment.start + HEAD + at - 1
}
