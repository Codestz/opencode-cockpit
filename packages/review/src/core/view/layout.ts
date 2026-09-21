/**
 * The whole view, as rows of styled runs.
 *
 * Composition, and nothing else. Each half of the screen is built by the module that owns it — the
 * list, the diff, the chrome — and this file arranges them: the gutter, the divider, the dimming of
 * whichever pane does not have the cursor, and the rows that say what is on screen so a click can be
 * turned back into a line.
 *
 * Nothing here knows about OpenTUI or about ANSI. The panel draws these rows and the preview CLI
 * paints the same ones, so what you look at in a terminal without OpenCode running is the layout
 * itself and not an impression of it — the one thing that made the statusline possible to design at
 * all.
 */

import type { ChangeSet, Review } from "../model/review.ts"
import { metrics } from "../perf.ts"
import { footerRows, headerRows } from "./chrome.ts"
import { awayRows, diffRows, withCursor } from "./diff.ts"
import { FOOTER_ROWS, GUTTER, HEADER_ROWS, inset, splitColumns, window } from "./geometry.ts"
import { fileRows, listScroll } from "./list.ts"
import { cell, faint, type Row } from "./rows.ts"
import type { Viewport, ViewState } from "./state.ts"

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
  /** A file with comments but no diff is drawn from its threads alone. */
  const away = state.file !== undefined && !changes.files.some((each) => each.path === state.file)
  const bodyRows = (width: number): Row[] =>
    away && state.file
      ? awayRows(state.file, review, state, width)
      : file
        ? diffRows(file, review, state, width)
        : []
  const blank = (width: number): Row => ({ runs: [{ text: " ".repeat(width) }] })

  const close = (built: Row[]): Row[] => {
    const feet = footerRows(content, columns, state)
    return [...built, ...feet.map((row, index) => (index === 0 ? rule : inset(row, inner)))]
  }

  /**
   * Nothing to review, and why.
   *
   * "Nothing has changed here" is true of an empty branch, of a conversation that has not edited
   * anything, and of a source that could not be read at all — and a reader who cannot tell those
   * apart reads all three as the pane being broken. So the empty state names the source it is empty
   * *for*, and points at the key that changes it.
   */
  if (changes.files.length === 0) {
    const said = state.label ? `Nothing to review in ${state.label}.` : "Nothing has changed here."
    const lines: Row[] = [{ runs: [{ text: cell(said, content), tone: "muted" }] }]
    if (body >= 3) {
      lines.push(blank(content))
      lines.push({
        runs: [
          {
            text: cell("[b] reads the other source: uncommitted, or what this branch changes.", content),
            tone: "muted",
            faint: true,
          },
        ],
      })
    }
    for (const line of lines) rows.push(inset(line, inner))
    for (let index = lines.length; index < body; index++) rows.push(blank(inner))
    return close(rows)
  }

  /** One column: the list, or the diff, never both squeezed into something unreadable. */
  if (columns.list === 0) {
    const only = file || away ? bodyRows(content) : fileRows(changes, review, state, content)
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
  const right = code(withCursor(window(bodyRows(columns.diff), state.scroll ?? 0, body), state))

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
