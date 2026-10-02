/** @jsxImportSource @opentui/solid */
import type { Host } from "@opencode-cockpit/client/host"
import type { ShellInfo } from "@opencode-cockpit/protocol/shell"
import { badgeText, kindColor, kindOf } from "../lib/view.ts"

/**
 * Status mark: the state's mark and its word, in the state's tone.
 *
 * Not a filled pill. A block of colour has to be as wide as the word inside it, and a list of
 * them reads as a wall of colour rather than as a list of shells. Not a `▌` rule either: that glyph
 * is the cursor everywhere else, so a list of shells read as a list of selections.
 */
export function Badge(props: { api: Host; shell: ShellInfo; frame: number }) {
  const theme = () => props.api.theme.current
  const kind = () => kindOf(props.shell)
  /**
   * Bold, like the colour, only for what asks something of you. Seven finished shells each saying
   * `DONE` in bold said nothing seven times; a finished one is muted and plain.
   */
  const loud = () => kind() === "run" || kind() === "fail"
  return (
    <text flexShrink={0} wrapMode="none" fg={kindColor(theme(), kind())}>
      {loud() ? <b>{badgeText(kind(), props.frame)}</b> : badgeText(kind(), props.frame)}
    </text>
  )
}
