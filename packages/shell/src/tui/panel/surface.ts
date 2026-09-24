import type { LogLine } from "@opencode-cockpit/protocol/shell"
import type { Notice, View } from "../lib/console.ts"

/**
 * The console's state, in one object — Review's `panel/surface.ts`, for Shell.
 *
 * One console, two sizes: the dialog and full screen read this same object, so nothing about what
 * you are looking at is lost when you switch between them. Plain mutable fields, not signals: full
 * screen lives in a slot, which is drawn once (docs/opencode/gotchas.md), so the console is *told*
 * about changes — something changes this, then asks for a paint.
 */
export interface Surface {
  /** Whether the console is showing at all. */
  open: boolean
  /** Over the whole window, or in the host's dialog. */
  full: boolean
  view: View
  /** Rows scrolled up from the bottom; 0 follows the output. */
  up: number
  /** Keys go to the program. */
  typing: boolean
  /** The log view's lines, as last read. */
  log: LogLine[]
  /** The log filter in force, and the query being typed for one. */
  filter: string
  searching: boolean
  draft: string
  /** A transient message that takes the key row's place. */
  notice?: Notice
}

export function createSurface(view: View = "screen"): Surface {
  return {
    open: false,
    full: false,
    view,
    up: 0,
    typing: false,
    log: [],
    filter: "",
    searching: false,
    draft: "",
  }
}
