/**
 * Rows the line draws about itself.
 *
 * Everything else here follows the rule that a segment with nothing to say says nothing — which is
 * right for data and wrong for the line's own failures. A module that would not load and a column
 * that ran out of rows both end as *segments that are simply not there*, indistinguishable from a
 * segment that had nothing to report, and the only notice either one gets is a toast that is gone
 * in ten seconds. Both cost a debugging session to tell apart from a bug in the module itself.
 *
 * So they get a row. It costs one line of the design and it says what happened where the person is
 * already looking.
 */

import { truncate } from "./format.ts"
import type { Segment } from "./types.ts"

/** Long enough to name the module, short enough for a sidebar column. */
const NOTICE = 30

/**
 * A column could not draw every row it was given. The preview has always said so; without this the
 * running TUI just left them out, and a row that never appears reads as a broken segment.
 */
export function overflowNotice(dropped: number): Segment | undefined {
  if (dropped <= 0) return undefined
  return {
    id: "notice.rows",
    priority: 0,
    runs: [{ text: `↳ ${dropped} more — raise maxRows`, tone: "muted", dim: true }],
  }
}

/**
 * A module did not load, so none of its segments exist. Named rather than counted where there is
 * only one, because the name is what turns "nothing drew" into something to go and fix.
 */
export function moduleNotice(errors: readonly string[], width = NOTICE): Segment | undefined {
  if (errors.length === 0) return undefined
  const text =
    errors.length === 1 ? truncate(errors[0] as string, width) : `${errors.length} modules failed to load`
  return { id: "notice.module", priority: 1000, runs: [{ text: `⚠ ${text}`, tone: "error" }] }
}
