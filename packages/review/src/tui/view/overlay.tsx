/** @jsxImportSource @opentui/solid */
// biome-ignore-all lint/a11y/noStaticElementInteractions: these are terminal boxes, not DOM elements
import type { Host } from "@opencode-cockpit/client/host"
import type { BoxRenderable, MouseEvent, TextRenderable } from "@opentui/core"
import type { JSX } from "solid-js"

export interface OverlayProps {
  api: Host
  /** Hands the boxes and the line pool up. Everything about them is set from the plugin. */
  onReady: (parts: { backdrop: BoxRenderable; panel: BoxRenderable; lines: TextRenderable[] }) => void
  /** A click landed outside the panel: dismiss, the way clicking off any overlay does. */
  onDismiss: () => void
  /** A click landed on the panel, at this screen column and row. */
  onClick: (x: number, y: number) => void
  /** The wheel turned over the panel: negative is up. */
  onScroll: (x: number, delta: number) => void
  /** A sideways swipe or shift+wheel over the panel: negative is left. */
  onPan: (x: number, delta: number) => void
}

/**
 * How many lines the panel can ever draw.
 *
 * Built once, because a slot's tree is read once — so the pool cannot grow later and has to be large
 * enough for any terminal. Hidden lines cost nothing to keep and the alternative is constructing
 * renderables from the plugin, which would mean importing OpenTUI's classes at runtime: a package
 * that is not installed beside a published plugin and would take the whole bundle down if the host
 * did not happen to provide it.
 */
const MAX_LINES = 300

/**
 * A full-window, transparent backdrop with the review panel inside it, and the panel's lines.
 *
 * The backdrop exists to catch two things, not to be seen. It gives the panel a parent that *is* the
 * window, so the panel only has to say how wide it wants to be — both earlier height bugs were a box
 * sized against the window while pinned to a parent at the foot of the screen. And it catches clicks
 * that land outside the panel, which is how an overlay is dismissed.
 *
 * **Nothing here is reactive.** The host reads a slot's children once and never revisits them — not
 * the tree shape, not `createEffect`, not the compiled prop effects. OpenTUI's setters (`visible`,
 * `width`, `content`…) request a frame when their value changes, so the plugin drives all of this by
 * assignment.
 */
export function Overlay(props: OverlayProps): JSX.Element {
  const theme = () => props.api.theme.current

  let backdrop: BoxRenderable | undefined
  let panel: BoxRenderable | undefined
  const lines: TextRenderable[] = []

  /**
   * Refs fire child-first, so nothing can assume its siblings exist yet. Handing everything up once
   * the last piece has arrived is the difference between a configured pane and a placeholder.
   */
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
        backgroundColor={theme().backgroundPanel}
        /** Kept from reaching the backdrop, whose mouse-down dismisses the review. */
        onMouseDown={(event: MouseEvent) => event.stopPropagation()}
        /**
         * Acted on at release, not press. A heading's `+ note` opens a dialog, and on press the dialog
         * was up in time to catch the release — landing on its backdrop, which closed it again.
         */
        onMouseUp={(event: MouseEvent) => {
          event.stopPropagation()
          props.onClick(event.x, event.y)
        }}
        onMouse={(event: MouseEvent) => {
          /** Wheel events arrive as mouse events carrying a scroll delta; everything else is a click. */
          const scroll = event.scroll
          if (!scroll) return
          event.stopPropagation()
          /**
           * Sideways is sideways. Only "up" used to count as up, so a trackpad swipe to the right
           * scrolled the diff down.
           */
          /** shift+wheel is sideways too, for a mouse with one wheel. */
          const sideways =
            scroll.direction === "left" || scroll.direction === "right" || event.modifiers?.shift
          const back = scroll.direction === "left" || scroll.direction === "up"
          if (sideways) props.onPan(event.x, back ? -6 : 6)
          else props.onScroll(event.x, back ? -3 : 3)
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
