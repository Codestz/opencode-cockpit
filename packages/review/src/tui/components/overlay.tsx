/** @jsxImportSource @opentui/solid */
// biome-ignore-all lint/a11y/noStaticElementInteractions: these are terminal boxes, not DOM elements
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { type BoxRenderable, type MouseEvent, RGBA } from "@opentui/core"
import type { JSX } from "solid-js"

export interface OverlayProps {
  api: TuiPluginApi
  /** Hands both boxes up. Everything about them is set from the plugin, imperatively. */
  onBoxes: (backdrop: BoxRenderable, panel: BoxRenderable) => void
  /** A click landed outside the panel: dismiss, the way clicking off any overlay does. */
  onDismiss: () => void
  /** A click landed on the panel, at this screen column and row. */
  onClick: (x: number, y: number) => void
  /** The wheel turned over the panel: negative is up. */
  onScroll: (x: number, delta: number) => void
}

/** Nothing painted: the conversation stays readable behind the panel. */
const TRANSPARENT = RGBA.fromValues(0, 0, 0, 0)

/**
 * A full-window, transparent backdrop with the review panel inside it.
 *
 * The backdrop exists to catch two things, not to be seen. It gives the panel a parent that *is* the
 * window, so the panel only has to say how wide it wants to be — both earlier height bugs were a box
 * sized against the window while pinned to a parent at the foot of the screen. And it catches clicks
 * that land outside the panel, which is how an overlay is supposed to be dismissed.
 *
 * **Nothing here is reactive.** The host reads a slot's children once and never revisits them — not
 * the tree shape, not `createEffect`, not the compiled prop effects. OpenTUI's setters (`visible`,
 * `width`, `title`…) request a frame when their value changes, so the plugin drives these by
 * assignment.
 */
export function Overlay(props: OverlayProps): JSX.Element {
  const theme = () => props.api.theme.current

  let backdrop: BoxRenderable | undefined
  let panel: BoxRenderable | undefined

  /**
   * Refs fire child-first, so neither box can assume the other exists yet. Handing them up only when
   * both have arrived is the difference between a configured pane and a placeholder: keying off the
   * backdrop while the panel's ref ran first meant the callback never fired at all, and both boxes kept
   * their dummy `width={20} height={0}`.
   */
  const ready = (element: BoxRenderable, which: "backdrop" | "panel") => {
    if (which === "backdrop") backdrop = element
    else panel = element
    if (backdrop && panel) props.onBoxes(backdrop, panel)
  }

  return (
    <box
      ref={(element: BoxRenderable) => ready(element, "backdrop")}
      visible={false}
      position="absolute"
      // Anchored bottom-right, never top-left. An absolute box is positioned against its parent, and
      // that parent is the `app_bottom` container at the very foot of the window: `top: 0` starts the
      // backdrop at the bottom and runs it off the screen, which looks exactly like nothing rendering.
      right={0}
      bottom={0}
      width={20}
      height={0}
      zIndex={1000}
      flexDirection="row"
      justifyContent="flex-end"
      backgroundColor={TRANSPARENT}
      onMouseDown={() => props.onDismiss()}
    >
      <box
        ref={(element: BoxRenderable) => ready(element, "panel")}
        width={20}
        height={0}
        flexShrink={0}
        flexDirection="column"
        border
        backgroundColor={theme().backgroundPanel}
        titleColor={theme().accent}
        // A click on the panel is not a click outside it.
        onMouseDown={(event: MouseEvent) => {
          event.stopPropagation()
          props.onClick(event.x, event.y)
        }}
        onMouse={(event: MouseEvent) => {
          /** Wheel events arrive as mouse events carrying a scroll delta; everything else is a click. */
          const scroll = event.scroll
          if (!scroll) return
          event.stopPropagation()
          props.onScroll(event.x, scroll.direction === "up" ? -3 : 3)
        }}
      />
    </box>
  )
}
