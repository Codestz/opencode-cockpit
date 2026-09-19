/** @jsxImportSource @opentui/solid */

import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { For, Show } from "solid-js"
import type { Segment, Tone } from "../../core/segments.ts"

/**
 * One line of segments. Colour comes from the running theme rather than literals, so the line
 * belongs to whatever theme the user has chosen — a statusline in someone else's palette is the
 * first thing that makes a plugin look bolted on.
 */

export function toneColor(api: TuiPluginApi, tone: Tone): string {
  const theme = api.theme.current
  switch (tone) {
    case "accent":
      return String(theme.accent)
    case "success":
      return String(theme.success)
    case "warning":
      return String(theme.warning)
    case "error":
      return String(theme.error)
    case "info":
      return String(theme.info)
    case "muted":
      return String(theme.textMuted)
    default:
      return String(theme.text)
  }
}

export interface StatusLineProps {
  api: TuiPluginApi
  segments: () => Segment[]
  separator: string
}

export function StatusLine(props: StatusLineProps) {
  return (
    <box flexDirection="row" flexShrink={0} paddingLeft={1} paddingRight={1}>
      <For each={props.segments()}>
        {(segment, index) => (
          <>
            <Show when={index() > 0}>
              <text fg={String(props.api.theme.current.borderSubtle)}>{props.separator}</text>
            </Show>
            <text fg={segment.color ?? toneColor(props.api, segment.tone)}>{segment.text}</text>
          </>
        )}
      </For>
    </box>
  )
}
