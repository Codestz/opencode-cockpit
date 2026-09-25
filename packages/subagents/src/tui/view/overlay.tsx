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
  /** The wheel turned over the screen: negative is up. */
  onScroll: (delta: number) => void
}

/**
 * The full screen's surface: a window-sized box and a pool of lines, and nothing else — Shell's
 * full-screen console, unchanged in shape.
 *
 * **Nothing here is reactive.** The host reads a slot's children once (docs/opencode/gotchas.md), so
 * the component hands its boxes up and the plugin assigns to them. Anchored bottom-right, because an
 * absolute box is placed against the `app_bottom` container at the foot of the window. Only props a
 * box actually uses: an unused one (`titleColor`) blanked Review's pane on OpenCode 2.
 */
export function Overlay(props: OverlayProps): JSX.Element {
  let backdrop: BoxRenderable | undefined
  const lines: TextRenderable[] = []
  /** Refs arrive child-first; act once both halves are here. */
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
