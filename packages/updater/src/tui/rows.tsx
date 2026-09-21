/** @jsxImportSource @opentui/solid */

import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import { For } from "solid-js"
import type { Fill, Row, Tone } from "../core/view/rows.ts"

/** Tones are named for meaning; the theme decides what they look like — as in Review. */
function ink(theme: TuiThemeCurrent, tone: Tone | undefined) {
  switch (tone) {
    case "muted":
      return theme.textMuted
    case "added":
      return theme.diffAdded
    case "removed":
      return theme.diffRemoved
    case "warning":
      return theme.warning
    case "accent":
      return theme.accent
    default:
      return theme.text
  }
}

function surface(theme: TuiThemeCurrent, fill: Fill | undefined) {
  return fill === undefined || fill === "none" ? undefined : theme.backgroundElement
}

/** The same rows the CLI prints, drawn in the theme's colours. Nothing here decides layout. */
export function Rows(props: { theme: () => TuiThemeCurrent; rows: () => Row[] }) {
  return (
    <box flexDirection="column">
      <For each={props.rows()}>
        {(row) => (
          <text wrapMode="none">
            <For each={row.runs}>
              {(run) => {
                const bg = surface(props.theme(), run.fill)
                return (
                  <span
                    style={{
                      fg: ink(props.theme(), run.tone),
                      ...(bg ? { bg } : {}),
                      ...(run.bold ? { bold: true } : {}),
                      // Faint is the terminal's own DIM bit, not a second grey: a row this screen
                      // cannot act on recedes behind rows that are merely quiet. The host's span takes
                      // `bold`/`dim` flags; a raw `attributes` number was measured to draw neither.
                      ...(run.faint ? { dim: true } : {}),
                    }}
                  >
                    {run.text}
                  </span>
                )
              }}
            </For>
          </text>
        )}
      </For>
    </box>
  )
}
