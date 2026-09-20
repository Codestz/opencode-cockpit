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
  type Note,
  noteIsStale,
  notesFor,
  notesOnLine,
  progress,
  type Review,
} from "../model/review.ts"
import type { HighlightedLine } from "./highlight.ts"
import { languageOf, type SyntaxState, tokenize } from "./syntax.ts"
import { type TreeRow, treeRows } from "./tree.ts"

/**
 * Tones, named for what they mean rather than for a colour. The diff ones map onto the theme keys
 * OpenCode already ships (`diffAdded`, `diffRemovedBg`, `diffLineNumber`, `diffHunkHeader`…), so a
 * review looks like the host's own diff rather than a second opinion about what green means.
 */
export type Tone =
  | "text"
  | "muted"
  | "accent"
  | "border"
  | "added"
  | "removed"
  | "hunk"
  | "lineNumber"
  | "success"
  | "warning"
  // Code, coloured from the theme's own syntax palette rather than a second opinion about what a
  // keyword looks like.
  | "keyword"
  | "string"
  | "number"
  | "comment"
  | "type"
  | "function"
  | "variable"
  | "operator"
  | "punct"

/** Backgrounds are separate: a changed line is tinted across its whole width, text or not. */
export type Fill = "none" | "added" | "removed" | "selected" | "panel"

export interface Run {
  text: string
  tone?: Tone
  fill?: Fill
  bold?: boolean
  /**
   * An exact colour, when something knows better than a tone does.
   *
   * A real highlighter returns colours, not categories — so it sets this and the renderers prefer it
   * over `tone`. Untyped because this file is pure: it is the terminal library's own colour object,
   * carried through untouched.
   */
  color?: unknown
  italic?: boolean
}

export interface Row {
  runs: Run[]
  /** Set on a row that is a line of the new file, so notes can attach to it. */
  line?: number
  /** The tree row this screen row stands for, so a click knows what it landed on. */
  target?: string
}

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

/** Pads or cuts to exactly `width` cells, so a column can never bleed into its neighbour. */
export function cell(text: string, width: number): string {
  if (width <= 0) return ""
  if (text.length === width) return text
  return text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text.padEnd(width)
}

/** Elides from the left: the filename identifies a file, the directories are context. */
export function elidePath(path: string, width: number): string {
  if (width <= 1) return ""
  if (path.length <= width) return path
  return `…${path.slice(path.length - width + 1)}`
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

const tallyOf = (file: FileChange) => `+${file.additions} −${file.deletions}`

/**
 * The same numbers, in their own colours.
 *
 * Grey `+11 −3` makes you read the digits to learn the shape of a change; green and red let you see it
 * without reading — which is the whole job of a file list you are scanning rather than studying.
 */
const tallyRuns = (file: FileChange | undefined): Run[] =>
  file
    ? [
        { text: ` +${file.additions}`, tone: "added" },
        { text: ` −${file.deletions}`, tone: "removed" },
      ]
    : []

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
    { text: `${seen.notes} notes `, tone: seen.notes > 0 ? "accent" : "muted" },
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
  /** The hints say what the keys do *here*, because `j` means two different things in two panes. */
  const inDiff = state.pane === "diff"
  const selecting = inDiff && state.anchor !== undefined

  /** While a selection is live, say what `c` would capture rather than what it usually does. */
  const lines =
    selecting && state.line !== undefined && state.anchor !== undefined
      ? Math.abs(state.line - state.anchor) + 1
      : 0

  const selected: Run[] = [
    { text: " ", tone: "muted" },
    { text: `${lines} line${lines === 1 ? "" : "s"} selected  `, tone: "accent", bold: true },
    { text: "j/k", tone: "accent", bold: true },
    { text: " extend  ", tone: "muted" },
    { text: "c", tone: "accent", bold: true },
    { text: " note them  ", tone: "muted" },
    { text: "v", tone: "accent", bold: true },
    { text: " cancel", tone: "muted" },
  ]

  const normal: Run[] = [
    { text: " tab", tone: "accent", bold: true },
    { text: inDiff ? " files  " : " diff  ", tone: "muted" },
    { text: "j/k", tone: "accent", bold: true },
    { text: inDiff ? " line  " : " file  ", tone: "muted" },
    ...(inDiff
      ? [
          { text: "v", tone: "accent" as const, bold: true },
          { text: " select  ", tone: "muted" as const },
          { text: "c", tone: "accent" as const, bold: true },
          { text: " note line  ", tone: "muted" as const },
        ]
      : [
          { text: "c", tone: "accent" as const, bold: true },
          { text: " note file  ", tone: "muted" as const },
        ]),
    { text: "f", tone: "accent", bold: true },
    { text: " note file  ", tone: "muted" },
    { text: "x", tone: "accent", bold: true },
    { text: " unnote  ", tone: "muted" },
    { text: "space", tone: "accent", bold: true },
    { text: " read  ", tone: "muted" },
    { text: "s", tone: "accent", bold: true },
    { text: " source  ", tone: "muted" },
    { text: "w", tone: "accent", bold: true },
    { text: " width  ", tone: "muted" },
    { text: "q", tone: "accent", bold: true },
    { text: " close", tone: "muted" },
  ]

  const hint = selecting ? selected : normal
  return [{ runs: [{ text: "─".repeat(width), tone: "border" }] }, { runs: clipRuns(hint, width, "none") }]
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

/** `@@ -60,7 +60,9 @@` — the real numbers, because a note citing the wrong line is worse than none. */
export function hunkHeader(hunk: Hunk, width: number): Row {
  const removed = hunk.lines.filter((line) => line.kind !== "add").length
  const added = hunk.lines.filter((line) => line.kind !== "remove").length
  const text = `@@ -${hunk.beforeStart},${removed} +${hunk.afterStart},${added} @@`
  return { runs: [{ text: cell(text, width), tone: "hunk", fill: "panel" }] }
}

/** Width of each line-number gutter. Two of them, old and new, the way a pull request shows it. */
const NUMBER_COLUMNS = 5

/** One file's diff: a header, then its hunks. */
/**
 * A note, drawn where it belongs.
 *
 * Marked when it has drifted: a note written against a line that a later turn has moved still means
 * what it meant, but the number no longer points at what the author was looking at — and a review that
 * silently cites the wrong line is worse than one that admits it.
 */
/**
 * A note, drawn as a block under the line it is about.
 *
 * A single indented line read as part of the diff — the eye went straight past it. A bordered block in
 * the panel tint is unmistakably *not* code, which is the whole job: a review is a conversation laid
 * over a file, and the two have to be told apart at a glance.
 *
 * Marked when it has drifted: a note written against a line a later turn has moved still means what it
 * meant, but the number no longer points at what the author was looking at — and a review that
 * silently cites the wrong line is worse than one that admits it.
 */
export function noteRows(note: Note, file: FileChange, width: number): Row[] {
  const stale = noteIsStale(note, file)
  const indent = "  "
  const box = Math.max(12, width - indent.length)
  const inner = box - 2

  const where =
    note.line === undefined
      ? "whole file"
      : note.through && note.through > note.line
        ? `lines ${note.line}–${note.through}`
        : `line ${note.line}`
  const title = ` note · ${where}${stale ? " · moved" : ""} `
  const tone: Tone = stale ? "warning" : "accent"

  const rows: Row[] = [
    {
      runs: [
        { text: indent },
        { text: "╭", tone, fill: "panel" },
        { text: title, tone, bold: true, fill: "panel" },
        { text: "─".repeat(Math.max(0, inner - title.length)), tone, fill: "panel" },
        { text: "╮", tone, fill: "panel" },
      ],
    },
  ]

  /** Wrapped to the box, because a note is prose and prose does not fit in one line of a diff. */
  const words = note.body.split(/\s+/).filter(Boolean)
  // indent + "│ " + room + "│" has to come to the same width as indent + "╭" + inner + "╮".
  const room = inner - 1
  const wrapped: string[] = []
  let line = ""
  for (const word of words) {
    if (line && line.length + word.length + 1 > room) {
      wrapped.push(line)
      line = word
    } else {
      line = line ? `${line} ${word}` : word
    }
  }
  if (line || wrapped.length === 0) wrapped.push(line)

  for (const text of wrapped) {
    rows.push({
      runs: [
        { text: indent },
        { text: "│ ", tone, fill: "panel" },
        { text: cell(text, room), tone: "text", fill: "panel" },
        { text: "│", tone, fill: "panel" },
      ],
    })
  }

  rows.push({
    runs: [
      { text: indent },
      { text: "╰", tone, fill: "panel" },
      { text: "─".repeat(inner), tone, fill: "panel" },
      { text: "╯", tone, fill: "panel" },
    ],
  })
  return rows
}

/**
 * Clips a line's runs to `width`, keeping their colours, and pads what is left.
 *
 * The first version swapped the whole line for one uncoloured string whenever it did not fit, which
 * is why a half-width pane looked unhighlighted: in a narrow column almost every line needs clipping,
 * so almost every line lost its colours. Truncation is a question about width and has nothing to say
 * about colour.
 */
export function clipRuns(runs: readonly Run[], width: number, fill: Fill): Run[] {
  if (width <= 0) return []
  const out: Run[] = []
  let used = 0
  for (const run of runs) {
    if (used >= width) break
    const room = width - used
    if (run.text.length <= room) {
      out.push(run)
      used += run.text.length
      continue
    }
    /** The last run standing gets an ellipsis, so a clipped line never pretends to be whole. */
    out.push({ ...run, text: room > 1 ? `${run.text.slice(0, room - 1)}…` : "…" })
    used = width
  }
  if (used < width) out.push({ text: " ".repeat(width - used), fill })
  return out
}

export function diffRows(file: FileChange, review: Review, state: ViewState, width: number): Row[] {
  if (width <= 0) return []
  const rows: Row[] = []
  const focused = state.pane === "diff"

  const tally = tallyOf(file)
  const room = Math.max(1, width - tally.length - 9)
  rows.push({
    target: file.path,
    runs: [
      { text: " ", fill: "panel" },
      { text: cell(elidePath(file.path, room), room), tone: "text", bold: true, fill: "panel" },
      { text: ` ${tally} `, tone: "muted", fill: "panel" },
      ...ratioBar(file),
      { text: " ", fill: "panel" },
    ],
  })

  /** A note about the file as a whole belongs under its header, before any line of it. */
  for (const note of notesFor(review, file.path).filter((each) => each.line === undefined)) {
    rows.push(...noteRows(note, file, width))
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
      const fill: Fill = here ? "selected" : added ? "added" : removed ? "removed" : "none"
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
          { text: String(line.before ?? "").padStart(NUMBER_COLUMNS - 1), tone: "lineNumber", fill },
          { text: String(line.after ?? "").padStart(NUMBER_COLUMNS), tone: "lineNumber", fill },
          { text: ` ${sign}`, tone: signTone, fill, bold: added || removed },
          ...clipRuns(painted, body, fill),
        ],
      })

      /** Notes sit under the line they are about, the way a review reads. */
      if (line.after !== undefined) {
        for (const note of notesOnLine(review, file.path, line.after)) {
          rows.push(...noteRows(note, file, width))
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
export function visibleDiffLines(
  changes: ChangeSet,
  review: Review,
  state: ViewState,
  viewport: Viewport,
): (number | undefined)[] {
  const columns = splitColumns(viewport.width)
  const inner = Math.max(0, viewport.width - 2)
  const width = columns.list === 0 ? inner : columns.diff
  const file = changes.files.find((candidate) => candidate.path === state.file) ?? changes.files[0]
  if (!file) return []
  const body = Math.max(1, viewport.height - HEADER_ROWS - FOOTER_ROWS)
  return window(diffRows(file, review, state, width), state.scroll ?? 0, body).map((row) => row.line)
}
