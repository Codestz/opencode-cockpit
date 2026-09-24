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

/**
 * Whether a colour would actually paint.
 *
 * A theme may leave a colour fully transparent — a terminal background that lets the wallpaper
 * through is the usual one — and a transparent *foreground* paints nothing at all: the word is
 * drawn and no one sees it. Alpha is 0..1 when the colour came from floats and 0..255 when it came
 * from ints, so the test is only against zero.
 */
const opaque = (colour: RGBA | undefined): colour is RGBA => colour !== undefined && colour.a > 0

/** Perceived lightness, 0..1, tolerant of both 0..1 and 0..255 channels. */
const lightness = (colour: RGBA): number => {
  const scale = Math.max(colour.r, colour.g, colour.b) > 1 ? 255 : 1
  return (0.2126 * colour.r + 0.7152 * colour.g + 0.0722 * colour.b) / scale
}

/** Below this the word and the block are too close to read apart. */
const SEPARATION = 0.3

/**
 * Ink for a word printed on a block of colour.
 *
 * A badge — ` YOU `, ` AGENT `, ` review ` — is a word cut out of a solid fill, so its colour is
 * not a matter of taste: it has to be legible against that fill, and a theme can break that two
 * ways. It can leave `background` transparent, which paints no ink and leaves a bare coloured
 * block (this is what a work machine showed: the blocks were there, the words were not). Or its
 * background can simply sit too near the accent to read.
 *
 * So the ink is chosen rather than assumed: the first theme colour that both paints and stands far
 * enough from the block. `undefined` means this theme has nothing that reads on it — the caller
 * then drops the block instead, which every theme can show.
 */
export const inkOn = (theme: TuiThemeCurrent, fill: RGBA | undefined): RGBA | undefined => {
  const candidates = [theme.background, theme.backgroundPanel, theme.backgroundElement, theme.text]
  const paints = candidates.filter(opaque)
  if (!opaque(fill)) return paints[0]
  const level = lightness(fill)
  return paints.find((colour) => Math.abs(lightness(colour) - level) >= SEPARATION)
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
    case "edge":
      return theme.backgroundElement
    /** `inverse` has no colour of its own: see `inkOn`, which picks one against the block it sits on. */
    case "inverse":
      return inkOn(theme, undefined) ?? theme.text
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
    case "heading":
      return theme.backgroundElement
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

/**
 * How far a faint run is pulled toward what is behind it.
 *
 * It used to be the terminal's own DIM, which many terminals draw at half brightness or less — the
 * pane without the cursor read as *disabled* rather than as "not the one you are typing into". A
 * blend of about a third keeps the text plainly readable and still says which half is active.
 */
const SOFTEN = 0.35
const softened = new WeakMap<RGBA, WeakMap<RGBA, RGBA>>()

/** `ink` a step toward `behind`, built from the colour's own class so nothing of OpenTUI is imported. */
const soften = (ink: RGBA, behind: RGBA): RGBA => {
  let byBack = softened.get(ink)
  const known = byBack?.get(behind)
  if (known) return known
  const Colour = ink.constructor as unknown as { clone: (colour: RGBA) => RGBA }
  const out = Colour.clone(ink)
  out.r = ink.r + (behind.r - ink.r) * SOFTEN
  out.g = ink.g + (behind.g - ink.g) * SOFTEN
  out.b = ink.b + (behind.b - ink.b) * SOFTEN
  if (!byBack) {
    byBack = new WeakMap()
    softened.set(ink, byBack)
  }
  byBack.set(behind, out)
  return out
}

/** One styled run becomes one chunk. An exact colour wins: a parser knows better than a tone does. */
const chunk = (theme: TuiThemeCurrent, run: Row["runs"][number]): TextChunk => {
  const fill = fillColour(theme, run.fill)
  const base = run.tone === "inverse" ? inkOn(theme, fill) : toneColour(theme, run.tone)
  /** Blend when there is a solid colour to blend toward; a see-through pane falls back to DIM. */
  const behind = opaque(fill) ? fill : opaque(theme.backgroundPanel) ? theme.backgroundPanel : undefined
  const blend = run.faint && behind !== undefined
  const ink = blend && base ? soften(base, behind) : base
  const attributes = (run.bold ? BOLD : 0) | (run.italic ? ITALIC : 0) | (run.faint && !blend ? DIM : 0)
  // No ink reads on this block, so the block goes: the badge becomes its own colour, in words.
  if (run.tone === "inverse" && ink === undefined)
    return { __isChunk: true, text: run.text, fg: fill ?? theme.text, bg: undefined, attributes } as TextChunk
  return {
    __isChunk: true,
    text: run.text,
    fg: run.color ? (blend ? soften(run.color as RGBA, behind as RGBA) : (run.color as RGBA)) : ink,
    bg: fill,
    attributes,
  } as TextChunk
}

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
