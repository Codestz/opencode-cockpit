/**
 * The whole view, as rows of styled runs.
 *
 * Nothing here knows about OpenTUI or about ANSI. The panel draws these rows and the preview paints
 * the same ones, so what you look at in a terminal without OpenCode running is the layout itself and
 * not an impression of it — the one thing that made the statusline possible to design at all.
 *
 * It also means the view is a pure function under test: that a long path is elided from the left, that
 * a hunk header carries the real line numbers, that the cursor moves the way the eye does, are all
 * assertions about a value rather than about pixels.
 */

import { type Hunk, toHunks } from "../diff/hunks.ts"
import {
  type ChangeSet,
  type FileChange,
  isRead,
  progress,
  type Review,
  threadDrifted,
  threadsFor,
  threadsOnLine,
} from "../model/review.ts"
import { metrics } from "../perf.ts"
import { cardRows } from "./card.ts"
import {
  cell,
  cellTail,
  clipRuns,
  elidePath,
  type Fill,
  type Row,
  type Run,
  rowWidth,
  type Tone,
} from "./rows.ts"
import { languageOf, type SyntaxState, tokenize } from "./syntax/index.ts"
import { type TreeRow, treeRows } from "./tree.ts"

/**
 * Tones, named for what they mean rather than for a colour. The diff ones map onto the theme keys
 * OpenCode already ships (`diffAdded`, `diffRemovedBg`, `diffLineNumber`, `diffHunkHeader`…), so a
 * review looks like the host's own diff rather than a second opinion about what green means.
 */
export interface Viewport {
  width: number
  height: number
}

export interface ViewState {
  /** The row the cursor is on — a file *or* a folder, by path. */
  cursor?: string
  /** The file whose diff is showing. */
  file?: string
  /** First visible row of the diff. */
  scroll?: number
  /** Unchanged lines kept either side of a change. */
  context?: number
  /** Folders whose contents are hidden, by path so toggling one cannot shift another. */
  collapsed?: ReadonlySet<string>
  /** The thread the cursor is on, drawn heavier and showing its keys. */
  thread?: string
  /**
   * What to call what is being reviewed — `feat/x → main` rather than the bare word "branch".
   * Named here rather than derived, because only the plugin knows what git says the branches are.
   */
  label?: string
  /**
   * Which half has the cursor. Two panes, one keyboard: `j` has to mean "next file" in one and "next
   * line" in the other, and the only honest way to say which is to show it.
   */
  pane?: "files" | "diff"
  /** The line of the new file the diff cursor sits on — what a comment would attach to. */
  line?: number
  /**
   * Where a multi-line selection started, if one is being made.
   *
   * A note about a loop is about the loop, not about whichever line you happened to be on — so the
   * range is held here and `line` is the moving end of it, the way a selection works anywhere else.
   */
  anchor?: number
  /**
   * First visible row of the file list.
   *
   * Its own scroll, separate from the cursor. Deriving it from the cursor made the wheel *select*
   * files as it moved the view, which reads as the list grabbing at you rather than scrolling.
   */
  listOffset?: number
  /**
   * Something went wrong, said where you are rather than in a log you have to go and find.
   *
   * Takes the footer's keys for as long as it is set: when the review is broken, what is broken is more
   * use than a row of keys you can get back with `?`.
   */
  notice?: string
  /** The numbers, when you have asked to see them. Same place, same reasoning. */
  stats?: readonly Run[]
}

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
const DIVIDER = 3

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

const tallyOf = (file: FileChange) =>
  [file.additions > 0 ? `+${file.additions}` : "", file.deletions > 0 ? `−${file.deletions}` : ""]
    .filter(Boolean)
    .join(" ")

/**
 * The same numbers, in their own colours.
 *
 * Grey `+11 −3` makes you read the digits to learn the shape of a change; green and red let you see it
 * without reading — which is the whole job of a file list you are scanning rather than studying.
 */
const tallyRuns = (file: FileChange | undefined): Run[] => {
  if (!file) return []
  /** A file that deleted nothing does not need telling you so forty times down a list. */
  return [
    ...(file.additions > 0 ? [{ text: ` +${file.additions}`, tone: "added" as const }] : []),
    ...(file.deletions > 0 ? [{ text: ` −${file.deletions}`, tone: "removed" as const }] : []),
  ]
}

/**
 * A five-cell bar of the add/remove ratio, the way a pull request shows it. Small, and the fastest
 * read on the screen for "how much of this is new".
 */
export function ratioBar(file: FileChange): Run[] {
  const total = file.additions + file.deletions
  const filled = total === 0 ? 0 : Math.max(1, Math.round((file.additions / total) * 5))
  return [
    { text: "■".repeat(filled), tone: "added" },
    { text: "■".repeat(5 - filled), tone: "removed" },
  ]
}

/** The bar across the top: what you are reading, and how far through it you are. */
export function headerRows(changes: ChangeSet, review: Review, width: number, label?: string): Row[] {
  const seen = progress(changes, review)
  /**
   * The bay names itself once, as a badge rather than a word.
   *
   * Solid-on-dark is how the eye finds the top-left of a pane without reading it, and it lets the
   * branch beside it be the brightest *text* on the row — which is the thing you actually came to
   * check.
   */
  const left: Run[] = [
    { text: " review ", tone: "inverse", fill: "you", bold: true },
    { text: "  ", fill: "panel" },
    { text: `${label ?? changes.source}`, tone: "text", bold: true, fill: "panel" },
    { text: "  ", fill: "panel" },
    { text: `+${seen.additions}`, tone: "added", fill: "selected" },
    { text: " ", fill: "selected" },
    { text: `−${seen.deletions}`, tone: "removed", fill: "selected" },
  ]
  /** What is left to do, in the order you run out of it: read it, answer it, finish it. */
  const bar = (): Run => ({ text: "  │  ", tone: "border", fill: "panel" })
  const right: Run[] = [
    { text: `${seen.read}/${seen.files} read`, tone: "muted", fill: "panel" },
    bar(),
    { text: `${seen.open} open`, tone: seen.open > 0 ? "accent" : "muted", fill: "panel" },
    ...(seen.threads > seen.open
      ? [
          bar(),
          { text: `${seen.threads - seen.open} resolved`, tone: "muted" as const, fill: "panel" as Fill },
        ]
      : []),
    { text: " ", fill: "panel" },
  ]
  const used = rowWidth({ runs: left })
  const tail = rowWidth({ runs: right })
  return [
    {
      runs: clipRuns(
        [...left, { text: " ".repeat(Math.max(0, width - used - tail)), fill: "panel" }, ...right],
        width,
        "panel",
      ),
    },
    { runs: [{ text: "─".repeat(width), tone: "border" }] },
  ]
}

/** The keys, on screen, because a surface whose keys are undiscoverable has none. */
export function footerRows(width: number, _columns: Columns, state: ViewState = {}): Row[] {
  const inDiff = state.pane === "diff"
  const selecting = inDiff && state.anchor !== undefined
  const lines =
    selecting && state.line !== undefined && state.anchor !== undefined
      ? Math.abs(state.line - state.anchor) + 1
      : 0

  /**
   * `[key] Label`, with the key bright and the label dim.
   *
   * A run-on string of `tab files  j/k line  v select` is a sentence you have to parse; a bracketed
   * key is a shape you recognise. The brackets do the work a colour would otherwise have to do, which
   * keeps the only saturated colours in the pane on the diff where they mean something.
   */
  const hint = (key: string, label: string): Run[] => [
    { text: `[${key}]`, tone: "accent", bold: true },
    { text: ` ${label}`, tone: "muted" },
    { text: "   " },
  ]

  /**
   * The keys you always have, then the ones this moment adds.
   *
   * An earlier version replaced the whole line whenever the cursor was near a thread, so moving and
   * selecting — the things you do constantly — disappeared behind two keys you use occasionally. A
   * hint that hides the basics to advertise the extras has it backwards.
   */
  const moving: Run[] = [
    { text: " " },
    ...hint("Tab", inDiff ? "Files" : "Diff"),
    ...hint("j/k", "Navigate"),
    ...(inDiff ? hint("v", "Select") : []),
  ]

  const extra: Run[] = selecting
    ? [
        { text: `${lines} line${lines === 1 ? "" : "s"}   `, tone: "accent", bold: true },
        ...hint("c", "Note Them"),
        ...hint("v", "Cancel"),
      ]
    : state.thread
      ? [...hint("c", "Reply"), ...hint("x", "Remove")]
      : [
          ...hint("c", inDiff ? "Note Line" : "Note File"),
          ...(inDiff ? hint("f", "Note File") : []),
          ...hint("space", "Read"),
        ]

  const tail: Run[] = [
    ...hint("s", "Submit"),
    ...hint("b", "Source"),
    ...hint("w", "Width"),
    ...hint("q", "Close"),
  ]

  /**
   * One line, and a queue for it: trouble, then numbers, then the keys.
   *
   * The footer stays exactly two rows however much it has to say, because the body's height is measured
   * from it — a footer that grew would push the diff about every time something went wrong.
   */
  const said: Run[] = state.notice
    ? [
        { text: " ! ", tone: "removed", bold: true },
        { text: state.notice, tone: "removed" },
      ]
    : state.stats
      ? [...state.stats]
      : [...moving, ...extra, ...tail]

  return [{ runs: [{ text: "─".repeat(width), tone: "border" }] }, { runs: clipRuns(said, width, "none") }]
}

/** One row per tree entry: folders with a count, files with their basename and tally. */
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

/** A handful of files: moving between two is common, and holding every file is not free. */
const REMEMBERED = 8

/** Everything about the state that changes a row, and nothing that does not. */
const signature = (file: FileChange, review: Review, state: ViewState, width: number): string =>
  [
    file.path,
    file.before.length,
    file.after.length,
    width,
    state.context ?? 3,
    state.thread ?? "",
    threadsFor(review, file.path)
      .map((thread) => `${thread.id}:${thread.status}:${thread.entries.length}`)
      .join(","),
  ].join("|")

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

function buildDiffRows(file: FileChange, review: Review, state: ViewState, width: number): Row[] {
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
        cardRows(each, { width: width - INDENT, height: 40 }, threadDrifted(each, file), {
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

      const code = tokenize(line.text, language, syntax)
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
      const onLine = line.after === undefined ? [] : threadsOnLine(review, file.path, line.after)
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
              cardRows(each, { width: width - INDENT, height: 40 }, threadDrifted(each, file), {
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

/** Everything on screen, as rows, for a viewport of this size. */
/**
 * The gutter down each side of the pane.
 *
 * Shell gets this from the box model — `paddingLeft`, `paddingRight` on a real nested box. This pane
 * paints a flat list of rows into a text pool, which is the only way a slot surface updates at all,
 * so every space has to be a character somebody emits. Emitted here, once, rather than remembered by
 * five different row builders.
 */
const GUTTER = 1

/**
 * Puts the gutter on a row and pads it out to the full width, so a fill reaches both edges.
 *
 * Without the padding a tinted row stopped where its text stopped, leaving a ragged right edge down
 * the diff wherever lines were short.
 */
const inset = (row: Row, width: number, fill: Fill = "none"): Row => {
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

export function layout(changes: ChangeSet, review: Review, state: ViewState, viewport: Viewport): Row[] {
  return metrics.time("layout", () => compose(changes, review, state, viewport))
}

/** Everything `layout` does. Split out so the timing above has something to wrap. */
function compose(changes: ChangeSet, review: Review, state: ViewState, viewport: Viewport): Row[] {
  const inner = Math.max(0, viewport.width - 2)
  /** What the content gets, once the pane has taken its gutter off each side. */
  const content = Math.max(1, inner - GUTTER * 2)
  const columns = splitColumns(content + 2)

  /** The rule spans the pane, edge to edge; everything with words in it sits inside the gutter. */
  const rule: Row = { runs: [{ text: "─".repeat(inner), tone: "border" }] }
  const rows: Row[] = headerRows(changes, review, content, state.label).map((row, index) =>
    index === HEADER_ROWS - 1 ? rule : inset(row, inner),
  )

  const body = Math.max(1, viewport.height - HEADER_ROWS - FOOTER_ROWS)
  const file = changes.files.find((candidate) => candidate.path === state.file) ?? changes.files[0]
  const blank = (width: number): Row => ({ runs: [{ text: " ".repeat(width) }] })

  const close = (built: Row[]): Row[] => {
    const feet = footerRows(content, columns, state)
    return [...built, ...feet.map((row, index) => (index === 0 ? rule : inset(row, inner)))]
  }

  if (changes.files.length === 0) {
    rows.push(inset({ runs: [{ text: cell("Nothing has changed here.", content), tone: "muted" }] }, inner))
    for (let index = 1; index < body; index++) rows.push(blank(inner))
    return close(rows)
  }

  /** One column: the list, or the diff, never both squeezed into something unreadable. */
  if (columns.list === 0) {
    const only = file ? diffRows(file, review, state, content) : fileRows(changes, review, state, content)
    const shown = withCursor(window(only, state.scroll ?? 0, body), state)
    for (let index = 0; index < body; index++) {
      const row = shown[index]
      rows.push(row ? inset(row, inner, row.runs[0]?.fill) : blank(inner))
    }
    return close(rows)
  }

  /** Whichever half does not have the cursor is dimmed, so the active one needs no outline. */
  const inDiff = state.pane === "diff"
  const list = (rows: Row[]) => (inDiff ? faint(rows) : rows)
  const code = (rows: Row[]) => (inDiff ? rows : faint(rows))
  const left = list(
    window(fileRows(changes, review, state, columns.list), listScroll(changes, state, body), body),
  )
  const right = code(
    withCursor(
      window(file ? diffRows(file, review, state, columns.diff) : [], state.scroll ?? 0, body),
      state,
    ),
  )

  for (let index = 0; index < body; index++) {
    const listRuns = left[index]?.runs ?? [{ text: " ".repeat(columns.list) }]
    const diffRuns = right[index]?.runs ?? [{ text: " ".repeat(columns.diff) }]
    rows.push(
      inset(
        {
          ...(left[index]?.target === undefined ? {} : { target: left[index]?.target }),
          ...(right[index]?.line === undefined ? {} : { line: right[index]?.line }),
          /** Air either side of the divider, so two columns of text never touch it. */
          runs: [
            ...listRuns,
            { text: " ", tone: "border" },
            { text: "│", tone: "border", faint: true },
            { text: " " }, // DIVIDER columns wide, which is what splitColumns set aside
            ...diffRuns,
          ],
        },
        inner,
      ),
    )
  }
  return close(rows)
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

/**
 * Everything on these rows, drawn dimmer.
 *
 * How an inactive pane says so. The alternative — a bright border around the active one — adds a line
 * to look at in order to say something about the pane you are already looking at, and two bright
 * borders on screen at once is how a terminal UI starts to look like a cockpit warning panel.
 *
 * Applied after windowing, like the cursor, so it costs the rows on screen and not the file.
 */
export function faint(rows: readonly Row[]): Row[] {
  return rows.map((row) => ({ ...row, runs: row.runs.map((run) => ({ ...run, faint: true })) }))
}

/** The visible slice, clamped so scrolling can never run off either end. */
export function window(rows: Row[], scroll: number, height: number): Row[] {
  const start = Math.max(0, Math.min(scroll, Math.max(0, rows.length - height)))
  return rows.slice(start, start + height)
}

/**
 * The lines the diff is showing, in the order they are drawn, with `undefined` where a row is not a
 * line of the new file — a hunk header, a file header, a note.
 *
 * Clicking needs this: row six on screen is whatever the sixth drawn row happens to be, and only the
 * layout knows what that is.
 */
export function visibleDiffRows(
  changes: ChangeSet,
  review: Review,
  state: ViewState,
  viewport: Viewport,
): { line?: number; target?: string }[] {
  const columns = splitColumns(viewport.width)
  const inner = Math.max(0, viewport.width - 2)
  const width = columns.list === 0 ? inner : columns.diff
  const file = changes.files.find((candidate) => candidate.path === state.file) ?? changes.files[0]
  if (!file) return []
  const body = Math.max(1, viewport.height - HEADER_ROWS - FOOTER_ROWS)
  return window(diffRows(file, review, state, width), state.scroll ?? 0, body).map((row) => ({
    ...(row.line === undefined ? {} : { line: row.line }),
    ...(row.target === undefined ? {} : { target: row.target }),
  }))
}

/** Just the lines, for walking the cursor down a file. */
export function visibleDiffLines(
  changes: ChangeSet,
  review: Review,
  state: ViewState,
  viewport: Viewport,
): (number | undefined)[] {
  return visibleDiffRows(changes, review, state, viewport).map((row) => row.line)
}

/**
 * Marks the line the cursor is on, and the lines a selection covers, on the rows that are visible.
 *
 * Applied after windowing rather than during the build: it touches one row in fifty, and baking it
 * into the build made every keypress rebuild the whole file. Fifty restyled rows is work you cannot
 * feel; three thousand tokenised lines is work you can.
 */
export function withCursor(rows: readonly Row[], state: ViewState): Row[] {
  if (state.pane !== "diff" || state.line === undefined) return rows as Row[]
  const from = Math.min(state.anchor ?? state.line, state.line)
  const to = Math.max(state.anchor ?? state.line, state.line)

  return rows.map((row) => {
    if (row.line === undefined || row.line < from || row.line > to) return row
    return {
      ...row,
      runs: [
        { ...(row.runs[0] ?? { text: " " }), text: "▌", tone: "accent" as Tone, fill: "selected" as Fill },
        ...row.runs.slice(1).map((run) => ({ ...run, fill: "selected" as Fill })),
      ],
    }
  })
}
