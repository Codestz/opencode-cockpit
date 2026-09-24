/** @jsxImportSource @opentui/solid */
import type { Host } from "@opencode-cockpit/client/host"
import type { ShellInfo } from "@opencode-cockpit/protocol/shell"
import { BADGE_RULE, badgeText, kindColor, kindOf } from "../lib/view.ts"

/**
 * Status mark: a coloured rule and its label.
 *
 * Not a filled pill. A block of colour has to be as wide as the word inside it, and a list of
 * them reads as a wall of colour rather than as a list of shells; the rule carries the same
 * meaning in one column.
 */
export function Badge(props: { api: Host; shell: ShellInfo; frame: number }) {
  const theme = () => props.api.theme.current
  const kind = () => kindOf(props.shell)
  const colour = () => kindColor(theme(), kind())
  return (
    <text flexShrink={0} wrapMode="none">
      <span style={{ fg: colour() }}>{BADGE_RULE}</span>
      <span style={{ fg: colour() }}>
        <b>{badgeText(kind(), props.frame).slice(BADGE_RULE.length)}</b>
      </span>
    </text>
  )
}
