/** @jsxImportSource @opentui/solid */
// biome-ignore-all lint/a11y/noStaticElementInteractions: these are terminal boxes, not DOM elements
import type { Host } from "@opencode-cockpit/client/host"
import type { BoxRenderable, MouseEvent, TextRenderable } from "@opentui/core"
import type { JSX } from "solid-js"

/** Enough lines for any terminal: a slot's tree is read once, so the pool cannot grow later. */
export const MAX_LINES = 300

export interface OverlayProps {
  api: Host
  onReady: (parts: { backdrop: BoxRenderable; panel: BoxRenderable; lines: TextRenderable[] }) => void
  /** A click landed outside the pane. */
  onDismiss: () => void
  /** A click landed on the pane, at this row of it. */
  onClick: (y: number) => void
  /** The wheel turned over the pane: negative is up. */
  onScroll: (delta: number) => void
}

/**
 * The pane's surface — Review's shape: a full-window, transparent backdrop that catches clicks off
 * the pane, and the pane inside it, right-aligned, half the window or all of it.
 *
 * **Nothing here is reactive.** The host reads a slot's children once (docs/opencode/gotchas.md), so
 * the component hands its boxes up and the plugin assigns to them. Anchored bottom-right, because an
 * absolute box is placed against the `app_bottom` container at the foot of the window. Only props a
 * box actually uses: an unused one (`titleColor`) blanked Review's pane on OpenCode 2.
 */
export function Overlay(props: OverlayProps): JSX.Element {
  let backdrop: BoxRenderable | undefined
  let panel: BoxRenderable | undefined
  const lines: TextRenderable[] = []
  /** Refs arrive child-first; act once every piece is here. */
  const ready = () => {
    if (backdrop && panel && lines.length === MAX_LINES) props.onReady({ backdrop, panel, lines })
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
      flexDirection="row"
      justifyContent="flex-end"
      backgroundColor="transparent"
      onMouseDown={() => props.onDismiss()}
    >
      <box
        ref={(element: BoxRenderable) => {
          panel = element
          ready()
        }}
        width={20}
        height={0}
        flexShrink={0}
        flexDirection="column"
        backgroundColor={props.api.theme.current.background}
        onMouseDown={(event: MouseEvent) => event.stopPropagation()}
        /** At release, not press, as Review learned: a press can land its release on what it opened. */
        onMouseUp={(event: MouseEvent) => {
          event.stopPropagation()
          props.onClick(event.y)
        }}
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
    </box>
  )
}
