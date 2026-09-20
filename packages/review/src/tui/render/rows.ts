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
import type { Fill, Row, Tone } from "../../core/view/rows.ts"

/** Tones are named for meaning; the theme decides what they look like. */
const toneColour = (theme: TuiThemeCurrent, tone: Tone | undefined): RGBA => {
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
    default:
      return theme.text
  }
}

const fillColour = (theme: TuiThemeCurrent, fill: Fill | undefined): RGBA | undefined => {
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
    default:
      return undefined
  }
}

/** One styled run becomes one chunk. An exact colour wins: a parser knows better than a tone does. */
const chunk = (theme: TuiThemeCurrent, run: Row["runs"][number]): TextChunk =>
  ({
    __isChunk: true,
    text: run.text,
    fg: (run.color as RGBA | undefined) ?? toneColour(theme, run.tone),
    bg: fillColour(theme, run.fill),
    attributes: (run.bold ? 1 : 0) | (run.italic ? 4 : 0),
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

  return {
    draw(rows, theme) {
      rows.forEach((row, index) => {
        const line = lines[index]
        if (!line) return
        line.content = styled(row.runs.map((run) => chunk(theme, run))) as never
        line.visible = true
      })
      /** Lines this view does not need are hidden, not destroyed: the next draw may want them. */
      for (let index = rows.length; index < lines.length; index++) {
        const line = lines[index]
        if (line) line.visible = false
      }
    },
    clear() {
      for (const line of lines) line.visible = false
    },
  }
}
