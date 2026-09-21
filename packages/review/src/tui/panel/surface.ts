/**
 * The state the panel shares, in one object.
 *
 * It was a dozen closure variables in `index.tsx`, which is why everything that touched them had to
 * live in `index.tsx` too — the file grew to a thousand lines not because any one part was large but
 * because nothing could be moved out without taking the state with it.
 *
 * Plain mutable fields, not signals. Nothing inside a slot's tree is reactive, so state the panel must
 * reflect is state the panel is *told* about: something changes this, then asks for a paint. Making it
 * an object rather than a store keeps that honest — there is no subscription here, and pretending
 * otherwise would invite the exact bug the platform has already taught us twice.
 */

import { emptyReview, type Review } from "../../core/model/review.ts"
import type { Variant } from "../../core/view/frame.ts"
import type { ViewState } from "../../core/view/state.ts"

export interface Surface {
  /** What is on screen: the cursor, the scroll, which pane has the keyboard, any selection. */
  view: ViewState
  /** The threads for the branch being reviewed. */
  review: Review
  /** Whether the panel is showing at all. */
  open: boolean
  /** Where it sits: a pane on the right, or the whole screen. */
  variant: Variant
  /** Whether the footer is showing the numbers instead of the keys. */
  showStats: boolean
}

export function createSurface(variant: Variant): Surface {
  return {
    /** Three lines of context either side of a change, which is what a diff reads like by default. */
    view: { context: 3, collapsed: new Set() },
    review: emptyReview(),
    open: false,
    variant,
    showStats: false,
  }
}
