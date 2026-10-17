/**
 * The pane's state: which subagent, and how it is being looked at — shared by what paints it
 * (`paint.ts`), what moves around it (`pane.ts`) and what types into it (`messages.ts`).
 */
export interface Surface {
  open?: string
  /** First body row shown; undefined follows the run. */
  top?: number
  selected?: string
  /** Items opened, or folded, by hand. */
  opened: Set<string>
  closed: Set<string>
  thinking: boolean
  details: boolean
  /** `?`: every key, in the body's place. */
  keys?: boolean
  /** Half the window, or all of it. Remembered. */
  full: boolean
  /** The message in the box at the foot of the pane, typed so far: kept when you stop typing. */
  draft?: string
  /** Keys go into the box (`tab`, a click on it) rather than to the pane; esc gives them back. */
  typing?: boolean
  /** The cursor in the draft, as an index into it; its end when unset. */
  caret?: number
  /**
   * Permissions answered from the pane, by request id, until the host says they were: hidden from
   * the card while the answer is on its way, and back on it with the error when it failed.
   */
  replies: Map<string, { error?: string }>
  notice?: string
  /** Calls shown whole rather than their first lines. */
  whole: Set<string>
  /** The cursor just moved: the next paint brings it into view, and only that one. */
  reveal?: boolean
  /** The subagent a first `x` asked to stop; a second `x` in time stops it. */
  stopping?: string
}
