/**
 * Putting rows on screen, by assignment.
 *
 * Nothing inside a slot's tree is reactive — not the shape, not `createEffect`, not the compiled prop
 * effects — so the panel cannot render a list by mapping over state the way a component would. What
 * *is* live is the renderable: OpenTUI's setters request a frame when their value changes.
 *
 * So the panel keeps a pool of text lines, one per visible row, and each draw assigns to them. The
 * pool is the size of the viewport, never the size of the file: a three-thousand-line diff scrolled to
 * the middle costs the same as a three-line one, because only what fits is ever built.
 */

import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import { type BoxRenderable, RGBA, StyledText, type TextChunk, TextRenderable } from "@opentui/core"
import type { Fill, Row, Tone } from "../../core/view/layout.ts"

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
    case "selected":
      return theme.backgroundElement
    case "panel":
      return theme.backgroundPanel
    default:
      return undefined
  }
}

/** One styled run becomes one chunk; a row becomes one `StyledText`. */
const chunk = (theme: TuiThemeCurrent, run: Row["runs"][number]): TextChunk => ({
  __isChunk: true,
  text: run.text,
  /** An exact colour wins: a real highlighter knows better than a tone does. */
  fg: run.color ? RGBA.fromHex(run.color) : toneColour(theme, run.tone),
  bg: fillColour(theme, run.fill),
  attributes: (run.bold ? 1 : 0) | (run.italic ? 4 : 0),
})

export interface RowPool {
  /** Draws these rows, growing or shrinking the pool to match. */
  draw: (rows: readonly Row[], theme: TuiThemeCurrent) => void
  /** Blanks every line without tearing the pool down, for a hidden panel. */
  clear: () => void
}

/**
 * A pool of text lines inside `panel`.
 *
 * Lines are created once and reused. Rebuilding the children on every draw would be simpler and is
 * what a component would do — it also allocates a renderable per line per keystroke, which a scroll
 * turns into thousands.
 */
export function createRowPool(panel: BoxRenderable): RowPool {
  const lines: TextRenderable[] = []

  const grow = (count: number) => {
    while (lines.length < count) {
      const line = new TextRenderable(panel.ctx, { content: "" })
      panel.add(line)
      lines.push(line)
    }
  }

  return {
    draw(rows, theme) {
      grow(rows.length)
      rows.forEach((row, index) => {
        const line = lines[index]
        if (!line) return
        line.content = new StyledText(row.runs.map((run) => chunk(theme, run)))
        line.visible = true
      })
      /** Lines the current view does not need are hidden, not destroyed: the next draw may want them. */
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
