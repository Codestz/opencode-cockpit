/** @jsxImportSource @opentui/solid */
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { ShellInfo } from "@opencode-cockpit/protocol/shell"
import { badgeText, kindColor, kindOf } from "./view.ts"

/** Status pill: label on a coloured background, readable in any font and colour scheme. */
export function Badge(props: { api: TuiPluginApi; shell: ShellInfo; frame: number }) {
  const theme = () => props.api.theme.current
  const kind = () => kindOf(props.shell)
  return (
    <text flexShrink={0} wrapMode="none">
      <span style={{ fg: theme().background, bg: kindColor(theme(), kind()) }}>
        <b>{badgeText(kind(), props.frame)}</b>
      </span>
    </text>
  )
}
