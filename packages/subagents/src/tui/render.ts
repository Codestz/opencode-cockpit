/**
 * The only place that knows what a tone looks like: every colour from the user's OpenCode theme,
 * through the host (so OpenCode 2's tokens arrive under the same names — client/host `themeFromV2`).
 *
 * Nothing of OpenTUI is imported at runtime: it is the host's, not installed beside a published
 * plugin (docs/opencode/v2.md). `StyledText` and the colour class are borrowed from objects the host
 * made, as Shell's and Review's pools do.
 */

import type { Theme } from "@opencode-cockpit/client/host"
import type { RGBA, TextChunk, TextRenderable } from "@opentui/core"
import type { Fill, Row, Run, Tone } from "../core/view/rows.ts"

const BOLD = 1 << 0
const ITALIC = 1 << 2

export function toneColour(theme: Theme, tone: Tone | undefined): RGBA {
  switch (tone) {
    case "muted":
      return theme.textMuted
    case "accent":
      return theme.accent
    case "info":
      return theme.info
    case "tool":
      return theme.primary
    case "success":
      return theme.success
    case "error":
      return theme.error
    case "warning":
      return theme.warning
    case "border":
      return theme.border
    default:
      return theme.text
  }
}

export function fillColour(theme: Theme, fill: Fill | undefined): RGBA | undefined {
  if (fill === "band") return theme.backgroundPanel
  if (fill === "block") return theme.backgroundElement
  return undefined
}

/** Bold is bold; faint is the muted colour in italics — the terminal's DIM draws too dark to read. */
export const attributesOf = (run: Run): number => (run.bold ? BOLD : 0) | (run.faint ? ITALIC : 0)

/**
 * A surface colour certain to paint. A theme may leave its backgrounds transparent (OpenCode's
 * "system" theme), and a full-window surface painted with one lets the conversation show through —
 * the 0.6 fix, carried over from Shell and Review.
 */
export function solidSurface(theme: Theme): RGBA {
  const found = [theme.background, theme.backgroundPanel, theme.backgroundElement].find(
    (c) => c !== undefined && c.a > 0,
  )
  if (found) return found
  const text = theme.text
  const scale = Math.max(text.r, text.g, text.b) > 1 ? 255 : 1
  const light = (0.2126 * text.r + 0.7152 * text.g + 0.0722 * text.b) / scale > 0.5
  const Colour = text.constructor as unknown as { fromHex?: (hex: string) => RGBA }
  return Colour.fromHex?.(light ? "#0b0b0e" : "#fafafa") ?? text
}

export interface RowPool {
  draw: (rows: readonly Row[], theme: Theme) => void
  clear: () => void
}

/** Rows onto a pool of lines — Shell's pool: only lines that changed are touched. */
export function createRowPool(lines: readonly TextRenderable[]): RowPool {
  type StyledTextish = { new (chunks: TextChunk[]): unknown }
  let StyledText: StyledTextish | undefined
  let painted: (string | undefined)[] = []
  let drawnWith: Theme | undefined

  const styled = (chunks: TextChunk[]): unknown => {
    if (!StyledText && lines[0]) {
      const found = (lines[0].content as unknown as object | undefined)?.constructor as
        | StyledTextish
        | undefined
      if (found && found !== Object) StyledText = found
    }
    return StyledText ? new StyledText(chunks) : chunks.map((part) => part.text).join("")
  }

  const chunk = (theme: Theme, run: Run): TextChunk =>
    ({
      __isChunk: true,
      text: run.text,
      fg: toneColour(theme, run.tone),
      bg: fillColour(theme, run.fill),
      attributes: attributesOf(run),
    }) as TextChunk

  return {
    draw(rows, theme) {
      /** A new theme changes every colour, so nothing on screen can be trusted to still be right. */
      const all = theme !== drawnWith
      drawnWith = theme
      rows.forEach((row, index) => {
        const line = lines[index]
        if (!line) return
        const key = JSON.stringify(row)
        if (all || painted[index] !== key) {
          line.content = styled(row.map((run) => chunk(theme, run))) as never
          painted[index] = key
        }
        line.visible = true
      })
      for (let index = rows.length; index < lines.length; index++) {
        const line = lines[index]
        if (line) line.visible = false
        painted[index] = undefined
      }
    },
    clear() {
      for (const line of lines) line.visible = false
      painted = []
    },
  }
}
