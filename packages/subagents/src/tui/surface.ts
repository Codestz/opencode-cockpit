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
  /** A message being typed, at the foot of the pane. */
  draft?: string
  notice?: string
  /** Calls shown whole rather than their first lines. */
  whole: Set<string>
  /** The cursor just moved: the next paint brings it into view, and only that one. */
  reveal?: boolean
  /** The subagent a first `x` asked to stop; a second `x` in time stops it. */
  stopping?: string
}
