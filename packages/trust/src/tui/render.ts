/**
 * The only place that knows what a tone looks like: every colour from the user's OpenCode theme,
 * through the host (so OpenCode 2's tokens arrive under the same names — client/host `themeFromV2`).
 */

import type { Theme } from "@opencode-cockpit/client/host"
import type { RGBA } from "@opentui/core"
import { type Fill, TINTS, type Tone } from "../core/view/rows.ts"

const opaque = (colour: RGBA | undefined): colour is RGBA => colour !== undefined && colour.a > 0

/** What the dialog is drawn on: the panel colour, or the background when a theme leaves the panel clear. */
const surface = (theme: Theme): RGBA | undefined =>
  opaque(theme.backgroundPanel)
    ? theme.backgroundPanel
    : opaque(theme.background)
      ? theme.background
      : undefined

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
    /** Text cut out of a solid accent: the surface's own colour, or the text's when there is none. */
    case "ink":
      return surface(theme) ?? theme.text
    default:
      return theme.text
  }
}

const mixed = new WeakMap<RGBA, WeakMap<RGBA, Map<number, RGBA>>>()

/**
 * `tone` faded into `behind`, `amount` of the way from it: a tint that follows the theme. Built from
 * the colour's own class, as Review's soften does, so nothing of OpenTUI is imported.
 */
function mix(tone: RGBA, behind: RGBA, amount: number): RGBA | undefined {
  const byBack = mixed.get(tone) ?? new WeakMap<RGBA, Map<number, RGBA>>()
  mixed.set(tone, byBack)
  const byAmount = byBack.get(behind) ?? new Map<number, RGBA>()
  byBack.set(behind, byAmount)
  const known = byAmount.get(amount)
  if (known) return known
  const Colour = tone.constructor as unknown as { clone?: (colour: RGBA) => RGBA }
  if (typeof Colour.clone !== "function" || typeof behind.r !== "number") return undefined
  const out = Colour.clone(behind)
  out.r = behind.r + (tone.r - behind.r) * amount
  out.g = behind.g + (tone.g - behind.g) * amount
  out.b = behind.b + (tone.b - behind.b) * amount
  byAmount.set(amount, out)
  return out
}

/**
 * What sits behind a run. The row-wide surfaces and the buttons are the theme's raised element; a
 * focused button is the accent; a chip or a badge is its tone's tint, and — on a theme whose dialog
 * has no colour to tint — no fill at all: the word keeps its tone and still says what it is.
 */
export function fillColour(theme: Theme, fill: Fill | undefined): RGBA | undefined {
  switch (fill) {
    case "selected":
    case "panel":
    case "button":
      return theme.backgroundElement
    case "buttonOn":
      return theme.accent
    case "chip":
    case "ok":
    case "warn":
    case "err": {
      const behind = surface(theme)
      if (!behind) return undefined
      const tint = TINTS[fill]
      return mix(toneColour(theme, tint.tone), behind, tint.amount)
    }
    default:
      return undefined
  }
}
