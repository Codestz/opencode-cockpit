/** @jsxImportSource @opentui/solid */
// biome-ignore-all lint/a11y/noStaticElementInteractions: these are terminal boxes, not DOM elements
import type { Host } from "@opencode-cockpit/client/host"
import type { BoxRenderable } from "@opentui/core"
import { For, type JSX } from "solid-js"
import type { SidebarLine } from "../../core/view/sidebar.ts"
import { fillColour, toneColour } from "../render.ts"

export interface SidebarProps {
  api: Host
  /** The block's lines, from `core/view/sidebar.ts`; a signal, so `<For>` redraws them. */
  lines: () => readonly SidebarLine[]
  onOpen: (id: string) => void
  /** The block's own box, so its rows can be drawn at the width the sidebar really gives it. */
  onReady?: (box: BoxRenderable) => void
}

/**
 * The Subagents block: the rows `core/view/sidebar.ts` produced, one `<text>` per row.
 *
 * Shell's and Status's sidebar pattern, proven live on both OpenCodes: a signal read by `<For>`
 * redraws, where anything decided once in a slot's tree never would (docs/opencode/gotchas.md).
 * Every line of a subagent opens it; mouse-up, not mouse-down, because the host acts on the release
 * that follows (as Shell's sidebar found).
 */
export function SidebarBlock(props: SidebarProps): JSX.Element {
  const theme = () => props.api.theme.current
  return (
    <box flexDirection="column" ref={(box: BoxRenderable) => props.onReady?.(box)}>
      <For each={props.lines()}>
        {(line) => (
          <box
            flexDirection="row"
            onMouseUp={() => {
              if (line.id) props.onOpen(line.id)
            }}
          >
            <text wrapMode="none" flexShrink={0}>
              <For each={line.row}>
                {(run) => {
                  const style = {
                    fg: toneColour(theme(), run.tone),
                    ...(run.fill && run.fill !== "none" ? { bg: fillColour(theme(), run.fill) } : {}),
                  }
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
