/**
 * The only place that knows what a tone looks like: every colour from the user's OpenCode theme,
 * through the host (so OpenCode 2's tokens arrive under the same names — client/host `themeFromV2`).
 */

import type { Theme } from "@opencode-cockpit/client/host"
import type { RGBA } from "@opentui/core"
import type { Fill, Tone } from "../core/view/rows.ts"

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
  return fill === "selected" ? theme.backgroundElement : undefined
}
