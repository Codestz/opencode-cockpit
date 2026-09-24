/**
 * The diff itself: hunks, lines, the notes threaded through them, and the cache that makes scrolling
 * free.
 *
 * Rows are built once per file and remembered by signature; the cursor is applied afterwards, over
 * the fifty rows on screen. Folding the cursor into the build made every keypress rebuild the whole
 * file, which is what a three-thousand-line diff felt like before anyone measured it.
 */

import { type Hunk, toHunks } from "../diff/hunks.ts"
import { type FileChange, type Review, threadAnchor, threadsFor, threadsOnLine } from "../model/review.ts"
import { metrics } from "../perf.ts"
import { cardRows } from "./card.ts"
import { tallyOf } from "./counts.ts"
import { cell, clipRuns, elidePath, type Fill, type Row, type Tone } from "./rows.ts"
import type { ViewState } from "./state.ts"
import { languageOf, type SyntaxState, tokenize } from "./syntax/index.ts"

/** The mark in a line's first column that says a thread is attached to it. */
const MARK = "▐"

/** Width of each line-number gutter. Two of them, old and new, the way a pull request shows it. */
const NUMBER_COLUMNS = 5

/**
 * How far a thread sits in: level with the code, past both line-number gutters and the sign column.
 *
 * At the margin a thread lined up with nothing on the screen and read as a separate layer laid over
 * the diff. Level with the code it is about, it reads as belonging to that line — which is what a
 * pull request does, and the reason its comments look attached rather than dropped on top.
 */
const INDENT = NUMBER_COLUMNS * 2 + 2

/**
 * Moves a thread's rows in from the margin, pads the band, and tags each row with its thread.
 *
 * The indent carries the comment's own surface rather than being left blank. Unfilled, it punched a
 * black hole through the tinted diff on the left of every conversation — the band has to reach the
 * edge to read as one surface instead of a gap with text beside it.
 *
 * A blank row of that surface above and below gives the band room to breathe. Without it a comment
 * starts on the line immediately after the code and ends immediately before the next, and the eye
 * has to find the boundary by colour alone — which is hard work on a screen that is already green.
 */
const indent = (rows: readonly Row[], id: string): Row[] =>
  rows.map((row) => ({
    target: id,
    runs: [{ text: " ".repeat(INDENT), fill: "comment" as Fill }, ...row.runs],
  }))

/** `@@ -60,7 +60,9 @@` — the real numbers, because a note citing the wrong line is worse than none. */
export function hunkHeader(hunk: Hunk, width: number): Row {
  const removed = hunk.lines.filter((line) => line.kind !== "add").length
  const added = hunk.lines.filter((line) => line.kind !== "remove").length
  const text = `@@ -${hunk.beforeStart},${removed} +${hunk.afterStart},${added} @@`
  return { runs: [{ text: cell(text, width), tone: "hunk", fill: "panel" }] }
}

/** One file's diff: a header, then its hunks. */
/**
 * A note, drawn where it belongs.
 *
 * Marked when it has drifted: a note written against a line that a later turn has moved still means
 * what it meant, but the number no longer points at what the author was looking at — and a review that
 * silently cites the wrong line is worse than one that admits it.
 */
/**
 * Rows already built, keyed by everything that changes them.
 *
 * A file's rows are built in full and then windowed down to what fits, so a three-thousand-line file
 * costs three thousand tokenised lines to show fifty — and twice per keypress, because moving the
 * cursor builds them once to find the lines and again to draw. Measured at 19ms a keystroke on a
 * 3,000-line file, which is felt.
 *
 * The cursor is deliberately not part of the key, because it is not part of what gets built: walking
 * a file is a cache hit and a restyle of the visible rows. Only the file, the conversation on it, or
 * the shape of the pane invalidates this.
 */
const built = new Map<string, Row[]>()

/** A screenful of files and some either side: the stream can show several at once. */
const REMEMBERED = 16

/**
 * Everything about the state that changes a row, and nothing that does not.
 *
 * The focused thread counts only for the file it is on. With every file in one stream, keying all of
 * them on it meant moving onto a note re-measured two hundred files that had not changed.
 */
const signature = (file: FileChange, review: Review, state: ViewState, width: number): string => {
  const threads = threadsFor(review, file.path)
  return [
    file.path,
    file.before.length,
    file.after.length,
    width,
    state.context ?? 3,
    threads.some((thread) => thread.id === state.thread) ? state.thread : "",
    threads.map((thread) => `${thread.id}:${thread.status}:${thread.entries.length}`).join(","),
  ].join("|")
}

/**
 * How many rows a file's diff takes, without drawing it.
 *
 * The stream needs every file's height to know where each one starts, and tokenising two hundred
 * files to count their rows is the cost virtualising exists to avoid. So the rows are built without
 * syntax — the same builder, so the count cannot drift from what is drawn — and only the count is kept.
 */
const heights = new Map<string, number>()
const MEASURED = 1000

export function diffHeight(file: FileChange, review: Review, state: ViewState, width: number): number {
  const key = signature(file, review, state, width)
  const drawn = built.get(key)
  if (drawn) return drawn.length
  const known = heights.get(key)
  if (known !== undefined) return known
  metrics.count("measures")
  const height = buildDiffRows(file, review, state, width, false).length
  if (heights.size >= MEASURED) {
    const oldest = heights.keys().next().value
    if (oldest !== undefined) heights.delete(oldest)
  }
  heights.set(key, height)
  return height
}

export function diffRows(file: FileChange, review: Review, state: ViewState, width: number): Row[] {
  const key = signature(file, review, state, width)
  const hit = built.get(key)
  if (hit) {
    metrics.count("hits")
    return hit
  }

  metrics.count("builds")
  const rows = metrics.time("build", () => buildDiffRows(file, review, state, width))
  /** Oldest out first: a plain map keeps insertion order, which is the only order that matters. */
  if (built.size >= REMEMBERED) {
    const oldest = built.keys().next().value
    if (oldest !== undefined) built.delete(oldest)
  }
  built.set(key, rows)
  return rows
}

function buildDiffRows(
  file: FileChange,
  review: Review,
  state: ViewState,
  width: number,
  paint = true,
): Row[] {
  if (width <= 0) return []
  const rows: Row[] = []

  /** The file's own thread is announced here, so the heading is built with room for it. */
  const whole = threadsFor(review, file.path).filter((each) => each.line === undefined)
  const badge = whole.length > 0 ? ` ${MARK} ${whole.length} ` : ""

  const tally = tallyOf(file)
  // a leading space + the path + " tally " + the badge = the column, exactly.
  const room = Math.max(1, width - tally.length - badge.length - 3)
  rows.push({
    ...(whole[0] ? { target: whole[0].id } : {}),
    runs: [
      { text: " ", fill: "panel" },
      { text: cell(elidePath(file.path, room), room), tone: "text", bold: true, fill: "panel" },
      /**
       * The numbers, and no bar of blocks beside them.
       *
       * A proportion bar is a second way of saying what `+2 −2` already said, in the loudest glyph on
       * the screen, on a row that is already a heading.
       */
      { text: ` ${tally} `, tone: "muted", fill: "panel" },
      ...(badge ? [{ text: badge, tone: "accent" as Tone, bold: true, fill: "panel" as Fill }] : []),
    ],
  })

  /** The file's own thread reads first, before any line of it. */
  for (const each of whole) {
    rows.push(
      ...indent(
        cardRows(each, { width: width - INDENT, height: 40 }, threadAnchor(each, file).state, {
          inline: true,
          focused: each.id === state.thread,
        }),
        each.id,
      ),
    )
  }

  const language = languageOf(file.path)
  const body = Math.max(0, width - NUMBER_COLUMNS * 2 - 2)

  for (const hunk of toHunks(file.before, file.after, { context: state.context ?? 3 })) {
    /**
     * A blank row above every hunk.
     *
     * A hunk is the paragraph break of a diff — it is where the file skips — and it was butting up
     * against both the code above it and the code below. This is the one place in a diff where air
     * carries meaning rather than just looking nicer.
     */
    rows.push({ runs: [{ text: " ".repeat(width) }] })
    rows.push(hunkHeader(hunk, width))
    /**
     * A block comment opened in one line is still open in the next, so the tokenizer's state travels
     * down the hunk. It restarts per hunk because the lines between hunks were never read.
     */
    let syntax: SyntaxState = { inBlockComment: false }

    for (const line of hunk.lines) {
      const added = line.kind === "add"
      const removed = line.kind === "remove"
      /**
       * The cursor is not built in.
       *
       * Which line you are standing on changes one row out of three thousand, and baking it into the
       * build meant every keypress rebuilt the file. It is applied to the visible rows instead — see
       * `withCursor` — so walking a file is a cache hit and a restyle of what fits on screen.
       */
      /**
       * Three tints, the way a pull request does it: the gutter loudly, the row faintly, and a
       * conversation on a surface of its own.
       *
       * One tint for all three is what made a file of pure additions read as a green field with text
       * on it, and left a comment nothing to stand out against.
       */
      const fill: Fill = added ? "added" : removed ? "removed" : "none"
      const gutter: Fill = added ? "addedNumber" : removed ? "removedNumber" : "none"
      /**
       * The sign is the loud part and the code is not: `success`/`error` for `+`/`−`, and the code
       * coloured as code. Painting a whole line green makes a diff harder to read, not easier — the
       * eye wants the change marked and the code legible.
       */
      const sign = added ? "+" : removed ? "−" : " "
      const signTone: Tone = added ? "success" : removed ? "removed" : "muted"

      const code = paint
        ? tokenize(line.text, language, syntax)
        : { runs: [{ text: line.text }], state: syntax }
      syntax = code.state
      const painted = code.runs.map((run) => ({ ...run, fill }))

      rows.push({
        ...(line.after === undefined ? {} : { line: line.after }),
        runs: [
          { text: " ", tone: "accent", fill },
          {
            text: String(line.before ?? "").padStart(NUMBER_COLUMNS - 1),
            tone: "lineNumber",
            fill: gutter,
          },
          {
            text: String(line.after ?? "").padStart(NUMBER_COLUMNS),
            tone: "lineNumber",
            fill: gutter,
          },
          { text: ` ${sign}`, tone: signTone, fill, bold: added || removed },
          ...clipRuns(painted, body, fill),
        ],
      })

      /**
       * A commented line is marked, not interrupted.
       *
       * Threads used to be drawn between the lines they were about, which pushed the code around as
       * the conversation grew and squeezed prose into a diff column. The mark says a thread is here;
       * the card is where it is read.
       */
      const onLine = line.after === undefined ? [] : threadsOnLine(review, file.path, line.after, file.after)
      const thread = onLine[0]
      if (thread) {
        const at = rows.at(-1)
        if (at) {
          const tone: Tone = thread.status === "resolved" ? "success" : "accent"
          rows[rows.length - 1] = {
            ...at,
            target: thread.id,
            runs: [{ text: MARK, tone, bold: true, fill }, ...at.runs.slice(1)],
          }
        }
        /**
         * Under the line, indented, with the code carrying on beneath it — which is where a pull
         * request puts a comment and where the eye expects to find one. It was briefly a card
         * floating over the diff; that hid the code it was about, and made "is this one open" a
         * question with answers.
         */
        for (const each of onLine) {
          rows.push(
            ...indent(
              cardRows(each, { width: width - INDENT, height: 40 }, threadAnchor(each, file).state, {
                inline: true,
                focused: each.id === state.thread,
              }),
              each.id,
            ),
          )
        }
      }
    }
  }
  return rows
}

/**
 * Marks the line the cursor is on, and the lines a selection covers, on the rows that are visible.
 *
 * Applied after windowing rather than during the build: it touches one row in fifty, and baking it
 * into the build made every keypress rebuild the whole file. Fifty restyled rows is work you cannot
 * feel; three thousand tokenised lines is work you can.
 */
export function withCursor(rows: readonly Row[], state: ViewState): Row[] {
  if (state.pane !== "diff") return rows as Row[]
  const { line } = state
  const from = line === undefined ? 0 : Math.min(state.anchor ?? line, line)
  const to = line === undefined ? -1 : Math.max(state.anchor ?? line, line)

  return rows.map((row) => {
    if (row.file !== undefined && row.file !== state.file) return row
    /** On a file's heading with no line: the heading is where the cursor is. */
    if (row.header) return line === undefined && row.file === state.file ? cursorOn(row) : row
    if (row.line === undefined || row.line < from || row.line > to) return row
    return cursorOn(row)
  })
}

const cursorOn = (row: Row): Row => ({
  ...row,
  runs: [
    { ...(row.runs[0] ?? { text: " " }), text: "▌", tone: "accent" as Tone, fill: "selected" as Fill },
    ...row.runs.slice(1).map((run) => ({ ...run, fill: "selected" as Fill })),
  ],
})

/**
 * A file's comments, with no diff to hang them on.
 *
 * What is left when the work has been committed away: the threads are still true, still answerable,
 * and have nowhere to sit. Rather than drop them, they are shown as they are — the code each one
 * quoted is inside the card already, which is the whole reason a thread keeps it.
 */
export function awayRows(path: string, review: Review, state: ViewState, width: number): Row[] {
  if (width <= 0) return []
  const rows: Row[] = [
    {
      runs: [
        { text: " ", fill: "panel" },
        {
          text: cell(elidePath(path, Math.max(1, width - 2)), Math.max(1, width - 2)),
          tone: "text",
          bold: true,
          fill: "panel",
        },
        { text: " ", fill: "panel" },
      ],
    },
    { runs: [{ text: " ".repeat(width) }] },
    {
      runs: [
        { text: "  " },
        {
          text: cell(
            "Not in this diff. The comments are here; the change is somewhere else — try another source with b.",
            Math.max(1, width - 2),
          ),
          tone: "muted",
        },
      ],
    },
    { runs: [{ text: " ".repeat(width) }] },
  ]
  for (const thread of threadsFor(review, path)) {
    rows.push(
      ...indent(
        cardRows(thread, { width: width - INDENT, height: 40 }, "current", {
          inline: true,
          focused: thread.id === state.thread,
        }),
        thread.id,
      ),
    )
  }
  return rows
}
