/**
 * Rows the line draws about itself.
 *
 * Everything else here follows the rule that a segment with nothing to say says nothing — which is
 * right for data and wrong for the line's own failures. A module that would not load, a setting that
 * is not read and a column that ran out of rows all end as *segments that are simply not
 * there*, indistinguishable from a segment that had nothing to report, and the only notice any of
 * them got was a toast that is gone in ten seconds. Each cost a debugging session to tell apart from
 * a bug in the module itself.
 *
 * So they get a row. It costs one line of the design and it says what happened where the person is
 * already looking.
 */

import { warnRows } from "@opencode-cockpit/client/design"
import { REMOVED_EXAMPLE } from "./custom.ts"
import { basename } from "./format.ts"
import type { Segment } from "./types.ts"

/**
 * A column could not draw every row it was given. The preview has always said so; without this the
 * running TUI just left them out, and a row that never appears reads as a broken segment.
 */
export function overflowNotice(dropped: number): Segment | undefined {
  if (dropped <= 0) return undefined
  return {
    id: "notice.rows",
    priority: 0,
    runs: [{ text: `↳ ${dropped} more — raise sidebarRows`, tone: "muted", dim: true }],
  }
}

/**
 * A module that did not load, as a notice: the file's name rather than the path written in the
 * config, which is the part a sidebar has room for and the part you go and fix.
 */
export function moduleNoticeText(error: string): string {
  const at = error.indexOf(": ")
  if (at === -1) return `module ${error}`
  const file = basename(error.slice(0, at))
  const why = error.slice(at + 2)
  /** One of the examples 0.9 folded into the `sidebar` preset: the fix, in as few words as fit. */
  if (why === REMOVED_EXAMPLE) return `${file} was ${why}`
  return `module ${file}: ${why}`
}

/**
 * Every notice, as the rows a surface draws: `!` in the warning tone, each sentence wrapped to the
 * room there is (`warnRows`), so a 24-column sidebar keeps the fix the sentence ends with. Above the
 * line and outside its row cap — a notice never pushes out a row you asked for, nor gives way to one.
 */
export function noticeRows(notices: readonly string[], width: number): Segment[] {
  return notices.flatMap((text, n) =>
    warnRows(text, width).map((runs, row) => ({
      id: `notice.${n}.${row}`,
      priority: 1000,
      runs: runs.map((run) => ({ text: run.text, ...(run.tone ? { tone: run.tone } : {}) })),
    })),
  )
}
