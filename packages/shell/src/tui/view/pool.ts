import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import type { RGBA, TextChunk, TextRenderable } from "@opentui/core"
import type { Row, Run, Tone } from "../lib/console.ts"

/**
 * Rows onto a pool of lines, the way Review's pool does it.
 *
 * Nothing of OpenTUI is imported at runtime — it is the host's, not installed beside a published
 * plugin. `StyledText` is read off a line (its content is an instance the host made) and a colour
 * class off a theme colour, so both come from the same object graph as everything else on screen.
 */
const BOLD = 1 << 0

/** Tones onto the theme — shared with the dialog, so both sizes are coloured by one table. */
export const toneColour = (theme: TuiThemeCurrent, name: Tone | undefined): RGBA => {
  switch (name) {
    case "muted":
      return theme.textMuted
    case "accent":
      return theme.accent
    case "success":
      return theme.success
    case "error":
      return theme.error
    case "warning":
      return theme.warning
    case "border":
      return theme.border
    case "match":
      return theme.background
    default:
      return theme.text
  }
}

/** What sits behind a run that has no colour of its own: the title bar's surface, or a search match. */
export const fillColour = (theme: TuiThemeCurrent, run: Run): RGBA | undefined =>
  run.tone === "match" ? theme.warning : run.raised ? theme.backgroundElement : undefined

/**
 * A surface colour that is certain to paint.
 *
 * A theme may leave its backgrounds fully transparent — OpenCode's "system" theme lets the terminal's
 * own background show through — and a full-window surface painted with one is not a surface at all:
 * the conversation underneath shows through it. So the first opaque of the theme's backgrounds, and
 * failing all of them, a solid near-black or near-white chosen against the text colour.
 */
export function solidSurface(theme: TuiThemeCurrent, prefer: "base" | "panel" = "base"): RGBA {
  const order =
    prefer === "panel"
      ? [theme.backgroundPanel, theme.background, theme.backgroundElement]
      : [theme.background, theme.backgroundPanel, theme.backgroundElement]
  const found = order.find((colour) => colour !== undefined && colour.a > 0)
  if (found) return found
  const text = theme.text
  const scale = Math.max(text.r, text.g, text.b) > 1 ? 255 : 1
  const light = (0.2126 * text.r + 0.7152 * text.g + 0.0722 * text.b) / scale > 0.5
  const Colour = text.constructor as unknown as { fromHex?: (hex: string) => RGBA }
  return Colour.fromHex?.(light ? "#0b0b0e" : "#fafafa") ?? text
}

export interface RowPool {
  draw: (rows: readonly Row[], theme: TuiThemeCurrent) => void
  clear: () => void
}

export function createRowPool(lines: readonly TextRenderable[]): RowPool {
  type StyledTextish = { new (chunks: TextChunk[]): unknown }
  let StyledText: StyledTextish | undefined
  const hex = new Map<string, RGBA>()
  /** What each line shows, so a paint only touches the lines that changed — as Review's pool does. */
  let painted: (string | undefined)[] = []
  let drawnWith: TuiThemeCurrent | undefined

  const styled = (chunks: TextChunk[]): unknown => {
    if (!StyledText && lines[0]) {
      const found = (lines[0].content as unknown as object | undefined)?.constructor as
        | StyledTextish
        | undefined
      if (found && found !== Object) StyledText = found
    }
    return StyledText ? new StyledText(chunks) : chunks.map((part) => part.text).join("")
  }

  /** "#rrggbb" as the host's own colour class, borrowed from a theme colour. */
  const colour = (theme: TuiThemeCurrent, value: string): RGBA | undefined => {
    const known = hex.get(value)
    if (known) return known
    const Colour = theme.text.constructor as unknown as { fromHex?: (hex: string) => RGBA }
    const made = Colour.fromHex?.(value)
    if (made) hex.set(value, made)
    return made
  }

  const chunk = (theme: TuiThemeCurrent, run: Run): TextChunk =>
    ({
      __isChunk: true,
      text: run.text,
      fg: (run.fg ? colour(theme, run.fg) : undefined) ?? toneColour(theme, run.tone),
      bg: (run.bg ? colour(theme, run.bg) : undefined) ?? fillColour(theme, run),
      attributes: run.bold ? BOLD : 0,
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
