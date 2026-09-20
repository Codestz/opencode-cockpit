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
import type { Thread } from "../model/thread.ts"
import { cardRows } from "./card.ts"
import type { HighlightedLine } from "./highlight.ts"
import { cell, clipRuns, elidePath, type Fill, type Row, type Run, type Tone } from "./rows.ts"
import { languageOf, type SyntaxState, tokenize } from "./syntax.ts"
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
   * Real highlighting for the file on screen, when a parser has produced some.
   *
   * Given as lines rather than fetched, because the view is a pure function: highlighting arrives from
   * a worker whenever it arrives, and the layout should not know that workers exist.
   */
  highlighted?: { before?: HighlightedLine[]; after?: HighlightedLine[] }
  /**
   * Which highlighter coloured what is on screen.
   *
   * On the header because "is this the real parser or the fallback?" is otherwise unanswerable by
   * looking — the two agree on most of an import line and disagree exactly where it matters.
   */
  syntax?: "tree-sitter" | "basic"
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
}

/** Rows above the list: the summary bar and its rule. */
export const HEADER_ROWS = 2
/** Rows below it: the rule and the key hints. */
export const FOOTER_ROWS = 2

/** Columns the file list takes, clamped: paths are bounded, code is not. */
export const MIN_LIST_COLUMNS = 24
export const MAX_LIST_COLUMNS = 40
export const LIST_SHARE = 0.3
/** Below this the diff column cannot hold a line of code, so the list gives up its space. */
export const MIN_DIFF_COLUMNS = 72

export interface Columns {
  list: number
  diff: number
}

export function splitColumns(width: number): Columns {
  const inner = Math.max(0, width - 2)
  const list = Math.min(MAX_LIST_COLUMNS, Math.max(MIN_LIST_COLUMNS, Math.floor(inner * LIST_SHARE)))
  const diff = inner - list - 1
  if (diff < MIN_DIFF_COLUMNS) return { list: 0, diff: inner }
  return { list, diff }
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
export function headerRows(
  changes: ChangeSet,
  review: Review,
  width: number,
  label?: string,
  syntax?: "tree-sitter" | "basic",
): Row[] {
  const seen = progress(changes, review)
  const left: Run[] = [
    { text: " review ", tone: "accent", bold: true },
    { text: `${label ?? changes.source} `, tone: "text", bold: true },
    { text: `${seen.files} files `, tone: "muted" },
    { text: `+${seen.additions} `, tone: "added" },
    { text: `−${seen.deletions}`, tone: "removed" },
  ]
  /**
   * Silence when the parser is doing its job, and a word when it is not.
   *
   * Announcing "tree-sitter" on every screen is a status light for a thing that is simply working —
   * noise. A *failure* must always speak, though: code coloured by the fallback looks plausible and is
   * only approximately right, so that case says so.
   */
  const right: Run[] = [
    ...(syntax === "basic"
      ? [
          { text: "basic syntax ", tone: "warning" as const },
          { text: "· ", tone: "border" as const },
        ]
      : []),
    { text: `${seen.read}/${seen.files} read `, tone: "muted" },
    { text: "· ", tone: "border" },
    { text: `${seen.open} open `, tone: seen.open > 0 ? "accent" : "muted" },
    ...(seen.threads > seen.open
      ? [
          { text: "· ", tone: "border" as const },
          { text: `${seen.threads - seen.open} resolved `, tone: "muted" as const },
        ]
      : []),
  ]
  const used = left.reduce((sum, run) => sum + run.text.length, 0)
  const tail = right.reduce((sum, run) => sum + run.text.length, 0)
  return [
    { runs: [...left, { text: " ".repeat(Math.max(0, width - used - tail)) }, ...right] },
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

  const key = (text: string): Run => ({ text, tone: "accent", bold: true })
  const says = (text: string): Run => ({ text, tone: "muted" })

  /**
   * The keys you always have, then the ones this moment adds.
   *
   * An earlier version replaced the whole line whenever the cursor was near a thread, so moving and
   * selecting — the things you do constantly — disappeared behind two keys you use occasionally. A
   * hint that hides the basics to advertise the extras has it backwards.
   */
  const moving: Run[] = [
    { text: " " },
    key("tab"),
    says(inDiff ? " files  " : " diff  "),
    key("j/k"),
    says(inDiff ? " line  " : " file  "),
    ...(inDiff ? [key("v"), says(" select  ")] : []),
    key("c"),
    says(inDiff ? " note line  " : " note file  "),
  ]

  const extra: Run[] = selecting
    ? [
        { text: `${lines} line${lines === 1 ? "" : "s"}  `, tone: "accent", bold: true },
        key("c"),
        says(" note them  "),
        key("v"),
        says(" cancel  "),
      ]
    : state.thread
      ? [key("r"), says(" reply  "), key("x"), says(" remove  ")]
      : [key("f"), says(" note file  "), key("space"), says(" read  ")]

  const tail: Run[] = [key("s"), says(" source  "), key("w"), says(" width  "), key("q"), says(" close")]

  return [
    { runs: [{ text: "─".repeat(width), tone: "border" }] },
    { runs: clipRuns([...moving, ...extra, ...tail], width, "none") },
  ]
}

/** One row per tree entry: folders with a count, files with their basename and tally. */
export function fileRows(changes: ChangeSet, review: Review, state: ViewState, width: number): Row[] {
  if (width <= 0) return []
  const byPath = new Map(changes.files.map((file) => [file.path, file]))

  return navigableRows(changes, state).map((row) => {
    const indent = "  ".repeat(row.depth)
    const here = row.path === state.cursor

    if (row.kind === "folder") {
      const count = `${row.files}`
      // 1 cursor + 1 gap + indent + 2 arrow + name + 1 gap + count = width, exactly.
      const room = Math.max(1, width - indent.length - count.length - 5)
      return {
        target: row.path,
        runs: [
          { text: here ? "▌" : " ", tone: "accent" },
          { text: " " },
          { text: indent },
          { text: state.collapsed?.has(row.path) ? "▸ " : "▾ ", tone: "muted" },
          { text: cell(row.name, room), tone: "text", bold: here, fill: here ? "selected" : "none" },
          { text: ` ${count}`, tone: "muted" },
        ],
      }
    }

    const file = byPath.get(row.path)
    const showing = row.path === state.file
    const read = isRead(review, row.path)
    const tally = file ? tallyOf(file) : ""
    // 1 cursor + 1 read + indent + 1 gap + name + tally runs (tally + 1) = width, exactly.
    const room = Math.max(1, width - indent.length - tally.length - 4)
    return {
      target: row.path,
      runs: [
        { text: here ? "▌" : " ", tone: "accent" },
        /** A tick when it has been read, and nothing at all when it has not — an unread marker on
         *  every row is noise on the rows you have not got to yet, which is most of them. */
        { text: read ? "✓" : " ", tone: "success" },
        { text: indent },
        { text: " " },
        {
          text: cell(row.name, room),
          tone: showing || here ? "text" : "muted",
          bold: showing,
          fill: here ? "selected" : "none",
        },
        ...tallyRuns(file),
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

/** Moves a thread's rows in from the margin, and tags each with the thread it belongs to. */
const indent = (rows: readonly Row[], id: string): Row[] =>
  rows.map((row) => ({ target: id, runs: [{ text: " ".repeat(INDENT) }, ...row.runs] }))

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
export function diffRows(file: FileChange, review: Review, state: ViewState, width: number): Row[] {
  if (width <= 0) return []
  const rows: Row[] = []
  const focused = state.pane === "diff"

  /** The file's own thread is announced here, so the heading is built with room for it. */
  const whole = threadsFor(review, file.path).filter((each) => each.line === undefined)
  const badge = whole.length > 0 ? ` ${MARK} ${whole.length} ` : ""

  const tally = tallyOf(file)
  const room = Math.max(1, width - tally.length - 9 - badge.length)
  rows.push({
    ...(whole[0] ? { target: whole[0].id } : {}),
    runs: [
      { text: " ", fill: "panel" },
      { text: cell(elidePath(file.path, room), room), tone: "text", bold: true, fill: "panel" },
      { text: ` ${tally} `, tone: "muted", fill: "panel" },
      ...ratioBar(file),
      { text: " ", fill: "panel" },
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
    rows.push(hunkHeader(hunk, width))
    /**
     * A block comment opened in one line is still open in the next, so the tokenizer's state travels
     * down the hunk. It restarts per hunk because the lines between hunks were never read.
     */
    let syntax: SyntaxState = { inBlockComment: false }

    for (const line of hunk.lines) {
      const added = line.kind === "add"
      const removed = line.kind === "remove"
      /** Inside the selection, or on the cursor when there is no selection. */
      const at = line.after
      const lowest =
        state.anchor === undefined ? state.line : Math.min(state.anchor, state.line ?? state.anchor)
      const highest =
        state.anchor === undefined ? state.line : Math.max(state.anchor, state.line ?? state.anchor)
      const here =
        focused &&
        at !== undefined &&
        lowest !== undefined &&
        highest !== undefined &&
        at >= lowest &&
        at <= highest
      /**
       * No background on a changed line.
       *
       * A tint across the whole row repeats what the `+` already said, and in a newly added file it
       * repeats it on every line — leaving the screen uniformly green with nothing for a comment to
       * stand out against. The sign and the line numbers carry the change; the background stays out
       * of it, so the only tinted thing on screen is a conversation.
       */
      const fill: Fill = here ? "selected" : "none"
      /**
       * The sign is the loud part and the code is not: `success`/`error` for `+`/`−`, and the code
       * coloured as code. Painting a whole line green makes a diff harder to read, not easier — the
       * eye wants the change marked and the code legible.
       */
      const sign = added ? "+" : removed ? "−" : " "
      const signTone: Tone = added ? "success" : removed ? "removed" : "muted"

      /**
       * A real parse when one has arrived, and the tokenizer until then. Highlighting is per side:
       * a removed line is a line of the *old* file, and colouring it from the new one would be a
       * confident lie about code that is no longer there.
       */
      const parsed = removed
        ? state.highlighted?.before?.[(line.before ?? 0) - 1]
        : state.highlighted?.after?.[(line.after ?? 0) - 1]
      const code = parsed
        ? { runs: parsed.spans.map((span) => ({ ...span, tone: "text" as Tone })), state: syntax }
        : tokenize(line.text, language, syntax)
      syntax = code.state
      const painted = code.runs.map((run) => ({ ...run, fill }))

      rows.push({
        ...(line.after === undefined ? {} : { line: line.after }),
        runs: [
          { text: here ? "▌" : " ", tone: "accent", fill },
          {
            text: String(line.before ?? "").padStart(NUMBER_COLUMNS - 1),
            tone: removed ? "removed" : "lineNumber",
            fill,
          },
          {
            text: String(line.after ?? "").padStart(NUMBER_COLUMNS),
            tone: added ? "added" : "lineNumber",
            fill,
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
export function layout(changes: ChangeSet, review: Review, state: ViewState, viewport: Viewport): Row[] {
  const columns = splitColumns(viewport.width)
  const inner = Math.max(0, viewport.width - 2)
  const rows: Row[] = [...headerRows(changes, review, inner, state.label, state.syntax)]

  const body = Math.max(1, viewport.height - HEADER_ROWS - FOOTER_ROWS)
  const file = changes.files.find((candidate) => candidate.path === state.file) ?? changes.files[0]

  if (changes.files.length === 0) {
    rows.push({ runs: [{ text: cell("  Nothing has changed here.", inner), tone: "muted" }] })
    for (let index = 1; index < body; index++) rows.push({ runs: [{ text: " ".repeat(inner) }] })
    rows.push(...footerRows(inner, columns, state))
    return rows
  }

  /** One column: the list, or the diff, never both squeezed into something unreadable. */
  if (columns.list === 0) {
    const only = file ? diffRows(file, review, state, inner) : fileRows(changes, review, state, inner)
    const shown = window(only, state.scroll ?? 0, body)
    for (let index = 0; index < body; index++) {
      rows.push(shown[index] ?? { runs: [{ text: " ".repeat(inner) }] })
    }
    rows.push(...footerRows(inner, columns, state))
    return rows
  }

  const list = window(fileRows(changes, review, state, columns.list), listScroll(changes, state, body), body)
  const diff = window(file ? diffRows(file, review, state, columns.diff) : [], state.scroll ?? 0, body)

  for (let index = 0; index < body; index++) {
    const left = list[index]?.runs ?? [{ text: " ".repeat(columns.list) }]
    const right = diff[index]?.runs ?? [{ text: " ".repeat(columns.diff) }]
    rows.push({
      ...(list[index]?.target === undefined ? {} : { target: list[index]?.target }),
      ...(diff[index]?.line === undefined ? {} : { line: diff[index]?.line }),
      runs: [...left, { text: "│", tone: "border" }, ...right],
    })
  }
  rows.push(...footerRows(inner, columns, state))
  return rows
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
