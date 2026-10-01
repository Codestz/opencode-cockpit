/**
 * Where the review is allowed to draw, and how the room inside it is divided.
 *
 * Pure geometry on purpose. A terminal interface is a visual artifact and the failure this repo
 * keeps rediscovering is designing one blind, so the numbers that decide the layout live here where
 * the preview CLI and the real pane read the *same* ones — and where a test can assert that nothing
 * draws wider than the window it was given.
 *
 * Nothing here knows about OpenTUI, ANSI, or OpenCode.
 */

/**
 * Where to draw, as a geometry inside one slot.
 *
 * Two views are wanted: a pane on the **right**, full height, over the conversation; and a **full
 * screen** for reading properly. Both hang from `app_bottom`, the slot Shell's dock and the statusline
 * already draw into — the `app` slot is not used, because "the whole app" is the host's own container
 * and a plugin registering it risks replacing the conversation rather than sitting over it.
 *
 * | variant | geometry                  | mechanism |
 * | ------- | ------------------------- | --------- |
 * | `full`  | in flow, the whole window | exactly what Shell's dock does, given the window's height |
 * | `right` | absolute, right half      | the same box, placed by us and lifted above the chat |
 *
 * `full` comes first deliberately, and is the default. `app_bottom` is in flow and *reflows the
 * conversation above it*, so a box given the window's height reflows the chat to nothing: a full
 * screen with no modal, uncapped, where the host's dialog stops at 116 columns and two readable
 * columns need about 145. It is also the control — if `full` draws, registration and the slot are both
 * fine and anything wrong with `right` is the absolute placement alone.
 */
export type Variant = "right" | "full"

export const VARIANTS: readonly Variant[] = ["right", "full"]

/**
 * Whether we place the box ourselves. An in-flow box is laid out by the host; an absolute box inside a
 * slot the host sizes is the case that may quietly paint behind the conversation, which is exactly
 * what these two variants exist to tell apart.
 */
export const isAbsolute = (variant: Variant): boolean => variant === "right"

export interface Size {
  width: number
  height: number
}

/** A frame's position and size in the window, in cells. */
export interface Frame extends Size {
  left: number
  top: number
}

/**
 * The host dialog caps at 116 columns (measured in `packages/shell/src/tui/components/console.tsx`).
 * Recorded rather than used: it is the reason there is no dialog variant here, since two readable
 * columns need about 145 and `full` is not capped at all.
 */
export const DIALOG_MAX_COLUMNS = 116

/**
 * What each variant really gets, given the window. Measured numbers, not guesses: if the dialog's
 * cap changes in a later OpenCode this is the one place that is wrong.
 */
/**
 * How much of the backdrop the panel takes.
 *
 * Both placements are full height — the panel is a child of a box that already is the window, so
 * height stopped being a question the moment the backdrop existed. Nothing is reserved for the prompt
 * either: the backdrop covers it, the review is modal while it is up, and closing gives it back.
 */
export function frameBounds(variant: Variant, screen: Size): Frame {
  if (variant === "full") return { left: 0, top: 0, width: screen.width, height: screen.height }
  const width = Math.max(40, Math.min(screen.width, Math.floor(screen.width / 2)))
  return { left: screen.width - width, top: 0, width, height: screen.height }
}

/*
 * How the room inside a frame is split between the file list and the diff lives in `geometry.ts`,
 * once. A second copy here had drifted to a different minimum (24 against 18) while nothing read it.
 */
