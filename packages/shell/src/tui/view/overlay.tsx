/** @jsxImportSource @opentui/solid */
// biome-ignore-all lint/a11y/noStaticElementInteractions: these are terminal boxes, not DOM elements
import type { Host } from "@opencode-cockpit/client/host"
import type { BoxRenderable, MouseEvent, TextRenderable } from "@opentui/core"
import type { JSX } from "solid-js"

/** Enough lines for any terminal: a slot's tree is read once, so the pool cannot grow later. */
export const MAX_LINES = 300

export interface OverlayProps {
  api: Host
  onReady: (parts: { backdrop: BoxRenderable; lines: TextRenderable[] }) => void
  /** The wheel turned over the console: negative is up. */
  onScroll: (delta: number) => void
}

/**
 * The full-screen console's surface: a window-sized box and a pool of lines, and nothing else.
 *
 * **Nothing here is reactive**, and that is the point. The host reads a slot's children once and never
 * again, so a component that renders from state renders once — which is what the first full-screen
 * console did: it mounted into nothing and left `/shell` in a state that drew no console at all. This
 * is Review's pattern instead: the component hands its boxes up, and the plugin assigns to them.
 * Anchored bottom-right, because an absolute box is placed against the `app_bottom` container at the
 * foot of the window (see Review's overlay).
 */
export function Overlay(props: OverlayProps): JSX.Element {
  let backdrop: BoxRenderable | undefined
  const lines: TextRenderable[] = []
  const ready = () => {
    if (backdrop && lines.length === MAX_LINES) props.onReady({ backdrop, lines })
  }
  return (
    <box
      ref={(element: BoxRenderable) => {
        backdrop = element
        ready()
      }}
      visible={false}
      position="absolute"
      right={0}
      bottom={0}
      width={20}
      height={0}
      zIndex={1000}
      flexDirection="column"
      backgroundColor={props.api.theme.current.background}
      onMouseDown={(event: MouseEvent) => event.stopPropagation()}
      onMouse={(event: MouseEvent) => {
        const scroll = event.scroll
        if (!scroll) return
        event.stopPropagation()
        props.onScroll(scroll.direction === "up" ? -3 : 3)
      }}
    >
      {Array.from({ length: MAX_LINES }, () => (
        <text
          wrapMode="none"
          flexShrink={0}
          visible={false}
          ref={(element: TextRenderable) => {
            lines.push(element)
            ready()
          }}
        />
      ))}
    </box>
  )
}
