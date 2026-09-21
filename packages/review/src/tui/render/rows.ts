/**
 * Putting rows on screen, by assignment.
 *
 * Nothing inside a slot's tree is reactive — not the shape, not `createEffect`, not the compiled prop
 * effects — so the panel cannot render a list by mapping over state the way a component would. What
 * *is* live is the renderable: OpenTUI's setters request a frame when their value changes.
 *
 * So the panel is handed a pool of text lines built once in its own JSX, and each draw assigns to
 * them. The pool is the size of the window, never the size of the file: a three-thousand-line diff
 * scrolled to the middle costs the same as a three-line one, because only what fits is ever drawn.
 *
 * **Nothing here imports OpenTUI.** `@opentui/core` is not installed beside a published plugin — it
 * has to come from the host — and a top-level import of it would take the whole bundle down, shell
 * and statusline included, if the host did not happen to provide it. The lines come from the
 * component, and `StyledText` is taken from a line's own `content`, which is the host's class by
 * construction.
 */

import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import type { RGBA, TextChunk, TextRenderable } from "@opentui/core"
import { metrics } from "../../core/perf.ts"
import type { Fill, Row, Tone } from "../../core/view/rows.ts"

/**
 * Whether a line is already showing this row.
 *
 * Compared field by field rather than by identity: the cached rows of a diff *are* the same objects
 * paint after paint, but the two-column view builds a fresh row per paint to join the halves, so
 * identity would report everything as changed in the view people use most. Twenty field comparisons
 * cost far less than building twenty chunks and a `StyledText`, which is what they replace — a scroll
 * of one line now touches one line instead of fifty.
 */
const sameRow = (was: Row | undefined, now: Row): boolean => {
  if (!was || was.runs.length !== now.runs.length) return false
  for (let index = 0; index < now.runs.length; index++) {
    const before = was.runs[index] as Row["runs"][number]
    const after = now.runs[index] as Row["runs"][number]
    if (
      before.text !== after.text ||
      before.tone !== after.tone ||
      before.fill !== after.fill ||
      before.bold !== after.bold ||
      before.italic !== after.italic ||
      before.faint !== after.faint ||
      before.color !== after.color
    )
      return false
  }
  return true
}

/** Tones are named for meaning; the theme decides what they look like. */
export const toneColour = (theme: TuiThemeCurrent, tone: Tone | undefined): RGBA => {
  switch (tone) {
    case "muted":
      return theme.textMuted
    case "accent":
      return theme.accent
    case "border":
      return theme.borderSubtle
    case "added":
      return theme.diffAdded
    case "removed":
      return theme.diffRemoved
    case "hunk":
      return theme.diffHunkHeader
    case "lineNumber":
      return theme.diffLineNumber
    case "success":
      return theme.success
    case "warning":
      return theme.warning
    case "keyword":
      return theme.syntaxKeyword
    case "string":
      return theme.syntaxString
    case "number":
      return theme.syntaxNumber
    case "comment":
      return theme.syntaxComment
    case "type":
      return theme.syntaxType
    case "function":
      return theme.syntaxFunction
    case "variable":
      return theme.syntaxVariable
    case "operator":
      return theme.syntaxOperator
    case "punct":
      return theme.syntaxPunctuation
    /** Ink for a solid badge: the panel's own background, used as a foreground. */
    case "inverse":
      return theme.background
    default:
      return theme.text
  }
}

export const fillColour = (theme: TuiThemeCurrent, fill: Fill | undefined): RGBA | undefined => {
  switch (fill) {
    case "added":
      return theme.diffAddedBg
    case "removed":
      return theme.diffRemovedBg
    case "addedNumber":
      return theme.diffAddedLineNumberBg
    case "removedNumber":
      return theme.diffRemovedLineNumberBg
    /** Neither side of the diff: a conversation is not an addition and not a deletion. */
    case "comment":
      return theme.backgroundElement
    case "selected":
      return theme.backgroundElement
    case "panel":
      return theme.backgroundPanel
    case "you":
      return theme.accent
    case "agent":
      return theme.warning
    default:
      return undefined
  }
}

/**
 * OpenTUI's `TextAttributes`, by value.
 *
 * Named here rather than imported: `@opentui/core` is the host's, not ours, and a static import of it
 * would take the whole bundle down where the host does not provide one. These bits are part of the
 * terminal's own vocabulary and have not moved since ANSI.
 */
const BOLD = 1 << 0
const DIM = 1 << 1
const ITALIC = 1 << 2

/** One styled run becomes one chunk. An exact colour wins: a parser knows better than a tone does. */
const chunk = (theme: TuiThemeCurrent, run: Row["runs"][number]): TextChunk =>
  ({
    __isChunk: true,
    text: run.text,
    fg: (run.color as RGBA | undefined) ?? toneColour(theme, run.tone),
    bg: fillColour(theme, run.fill),
    attributes: (run.bold ? BOLD : 0) | (run.italic ? ITALIC : 0) | (run.faint ? DIM : 0),
  }) as TextChunk

export interface RowPool {
  /** Draws these rows onto the pool's lines. */
  draw: (rows: readonly Row[], theme: TuiThemeCurrent) => void
  /** Blanks every line without tearing anything down, for a hidden panel. */
  clear: () => void
}

/**
 * A pool over lines the component already built.
 *
 * `StyledText` is read off a line rather than imported: the getter hands back an instance the host
 * made, so its constructor is the host's class — the same object graph, with no module resolution
 * involved. Building a styled line is the one thing here that needs a class at all.
 */
export function createRowPool(lines: readonly TextRenderable[]): RowPool {
  type StyledTextish = { new (chunks: TextChunk[]): unknown }
  let StyledText: StyledTextish | undefined

  const styled = (chunks: TextChunk[]): unknown => {
    if (!StyledText && lines[0]) {
      const sample = lines[0].content as unknown as object | undefined
      const found = sample?.constructor as StyledTextish | undefined
      if (found && found !== Object) StyledText = found
    }
    return StyledText ? new StyledText(chunks) : chunks.map((part) => part.text).join("")
  }

  /** What each line is currently showing, so a paint can tell what actually changed. */
  let painted: (Row | undefined)[] = []
  let theme: TuiThemeCurrent | undefined

  return {
    draw(rows, current) {
      /** A new theme changes every colour, so nothing on screen can be trusted to still be right. */
      const all = current !== theme
      theme = current
      let touched = 0

      rows.forEach((row, index) => {
        const line = lines[index]
        if (!line) return
        if (!all && sameRow(painted[index], row)) {
          line.visible = true
          return
        }
        line.content = styled(row.runs.map((run) => chunk(current, run))) as never
        line.visible = true
        painted[index] = row
        touched++
      })

      /** Lines this view does not need are hidden, not destroyed: the next draw may want them. */
      for (let index = rows.length; index < lines.length; index++) {
        const line = lines[index]
        if (line) line.visible = false
        painted[index] = undefined
      }
      metrics.count("lines", touched)
    },
    clear() {
      for (const line of lines) line.visible = false
      painted = []
    },
  }
}
