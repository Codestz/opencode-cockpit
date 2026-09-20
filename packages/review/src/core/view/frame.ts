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

/**
 * How the room inside a frame is split between the file list and the diff.
 *
 * `list: 0` means one column: the frame is too narrow to show both, so the view shows the list or
 * the diff and `tab` swaps them.
 */
export interface Columns {
  /** Columns for the file list. `0` for a single-column view. */
  list: number
  /** Columns for the diff body. */
  diff: number
}

/**
 * The narrowest a diff column may be before two columns stop being worth it. A line of code plus
 * its line number and a change marker is the thing that has to fit.
 */
export const MIN_DIFF_COLUMNS = 72

/** The narrowest a file list may be before a path stops being recognisable in it. */
export const MIN_LIST_COLUMNS = 24

/** The widest it is worth making one: past this, extra columns are spent on trailing whitespace. */
export const MAX_LIST_COLUMNS = 40

/** The share of a frame the list asks for, before the clamps above have their say. */
export const LIST_SHARE = 0.3

/**
 * How the room inside a frame is split between the file list and the diff, decided by looking at it.
 *
 * The first version was an even 50/50 — what had been asked for, and wrong for the reason a screenshot
 * makes obvious. Paths are short and bounded; lines of code are neither.
 */
export function splitColumns(width: number): Columns {
  const inner = Math.max(0, width - 2) // the frame's border
  /**
   * Clamped, not even. A 50/50 split is indefensible once you see it rendered: the left column holds
   * file names and the right holds code, and code is the longer of the two by a wide margin — an even
   * split spends half a 200-column terminal on `packages/review/src/core/frame.ts` and starves the
   * lines you are actually reading.
   *
   * It is also what makes two columns possible in the right-hand pane at all. Half of a 210-column
   * terminal is 103 usable columns: an even split leaves 51 for code, which is not a code column, and
   * this leaves 72, which is.
   */
  const list = Math.min(MAX_LIST_COLUMNS, Math.max(MIN_LIST_COLUMNS, Math.floor(inner * LIST_SHARE)))
  const diff = inner - list - 1 // -1 for the divider between them
  /** Below this there is no honest two-column view, so the list and the diff take turns instead. */
  if (diff < MIN_DIFF_COLUMNS) return { list: 0, diff: inner }
  return { list, diff }
}
