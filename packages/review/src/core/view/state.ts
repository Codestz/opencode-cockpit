/**
 * What the view is looking at.
 *
 * The seam every row builder shares: the file list, the diff, the header and the footer all read this
 * and none of them may change it. Kept in a file of its own because it is the one piece of the view
 * everything imports — when it lived in `layout.ts`, importing the shape of the state meant importing
 * the thing that draws the whole screen.
 */

import type { Run } from "./rows.ts"

/**
 * Tones, named for what they mean rather than for a colour. The diff ones map onto the theme keys
 * OpenCode already ships (`diffAdded`, `diffRemovedBg`, `diffLineNumber`, `diffHunkHeader`…), so a
 * review looks like the host's own diff rather than a second opinion about what green means.
 */
export interface Viewport {
  width: number
  height: number
}

export interface ViewState {
  /** The row the cursor is on — a file *or* a folder, by path. */
  cursor?: string
  /** The file whose diff is showing. */
  file?: string
  /**
   * First visible row of the diff — of the whole stream of files, not of one.
   *
   * Undefined means "wherever `file` starts", which is what opening a file asks for without having
   * to know how tall everything above it is.
   */
  scroll?: number
  /**
   * Files folded, or unfolded, by hand. Everything else follows the default: open until you mark it
   * viewed, and a very large diff starts folded. The two sets override that default either way, the
   * way GitHub's per-file toggle does.
   */
  folded?: ReadonlySet<string>
  opened?: ReadonlySet<string>
  /** Unchanged lines kept either side of a change. */
  context?: number
  /**
   * Columns the code is scrolled to the right. A line longer than the pane used to end in "…" with no
   * way to read the rest; the numbers and the +/− stay where they are, only the code moves.
   */
  shift?: number
  /** Folders whose contents are hidden, by path so toggling one cannot shift another. */
  collapsed?: ReadonlySet<string>
  /** The thread the cursor is on, drawn heavier and showing its keys. */
  thread?: string
  /**
   * What to call what is being reviewed — `feat/x → main` rather than the bare word "branch".
   * Named here rather than derived, because only the plugin knows what git says the branches are.
   */
  label?: string
  /**
   * Which half has the cursor. Two panes, one keyboard: `j` has to mean "next file" in one and "next
   * line" in the other, and the only honest way to say which is to show it.
   */
  pane?: "files" | "diff"
  /** The line of the new file the diff cursor sits on — what a comment would attach to. */
  line?: number
  /**
   * Where a multi-line selection started, if one is being made.
   *
   * A note about a loop is about the loop, not about whichever line you happened to be on — so the
   * range is held here and `line` is the moving end of it, the way a selection works anywhere else.
   */
  anchor?: number
  /**
   * First visible row of the file list.
   *
   * Its own scroll, separate from the cursor. Deriving it from the cursor made the wheel *select*
   * files as it moved the view, which reads as the list grabbing at you rather than scrolling.
   */
  listOffset?: number
  /**
   * Something went wrong, said where you are rather than in a log you have to go and find.
   *
   * Takes the footer's keys for as long as it is set: when the review is broken, what is broken is more
   * use than a row of keys you can get back with `?`.
   */
  notice?: string
  /** The numbers, when you have asked to see them. Same place, same reasoning. */
  stats?: readonly Run[]
  /**
   * Files that have comments on them but are not in this diff.
   *
   * Passed in rather than derived, because only the composition knows both the review and the change
   * set — and the list must not start reaching for one to draw the other.
   */
  elsewhere?: readonly string[]
  /**
   * How many comments are waiting on the agent — what pressing `s` would hand over.
   *
   * On the footer rather than in a dialog, because the question "is there anything to submit" is one
   * you have while reading, and the answer was previously only available by pressing the key.
   */
  waiting?: number
}
