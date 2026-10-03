/** @jsxImportSource @opentui/solid */
// biome-ignore-all lint/a11y/noStaticElementInteractions: these are terminal boxes, not DOM elements
import type { Host } from "@opencode-cockpit/client/host"
import type { BoxRenderable } from "@opentui/core"
import { For, type JSX } from "solid-js"
import type { Row } from "../../core/view/rows.ts"
import { fillColour, toneColour } from "../render.ts"

export interface RowsProps {
  api: Host
  /** The rows `core/view/` produced; a signal, so `<For>` redraws them. */
  rows: () => readonly Row[]
  onReady?: (box: BoxRenderable) => void
  /** A click on a row, by its index. Read on release: the host acts on the release that follows a press. */
  onRow?: (y: number) => void
}

/**
 * Rows of runs, one `<text>` per row, each in a box of its own so a click knows its row — the drawing
 * both the sidebar block and `/trail` use.
 *
 * Shell's and Subagents' pattern, proven live on both OpenCodes: a signal read by `<For>` redraws,
 * where anything decided once in a slot's tree never would (docs/opencode/gotchas.md, "Slots"). The
 * shape never changes; only the list of rows does.
 */
export function Rows(props: RowsProps): JSX.Element {
  const theme = () => props.api.theme.current
  return (
    <box flexDirection="column" ref={(box: BoxRenderable) => props.onReady?.(box)}>
      <For each={props.rows()}>
        {(row, index) => (
          <box flexDirection="row" onMouseUp={() => props.onRow?.(index())}>
            <text wrapMode="none" flexShrink={0}>
              <For each={row}>
                {(run) => {
                  const fill = fillColour(theme(), run.fill)
                  const style = { fg: toneColour(theme(), run.tone), ...(fill ? { bg: fill } : {}) }
                  return run.bold ? (
                    <span style={style}>
                      <b>{run.text}</b>
                    </span>
                  ) : run.faint ? (
                    <span style={style}>
                      <i>{run.text}</i>
                    </span>
                  ) : (
                    <span style={style}>{run.text}</span>
                  )
                }}
              </For>
            </text>
          </box>
        )}
      </For>
    </box>
  )
}
