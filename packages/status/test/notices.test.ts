import { describe, expect, test } from "bun:test"
import { REMOVED_EXAMPLE } from "../src/core/custom.ts"
import { moduleNoticeText, noticeRows, overflowNotice } from "../src/core/notices.ts"
import { type Segment, segmentText } from "../src/core/segments.ts"

/**
 * These exist because a failure that draws nothing is indistinguishable from a segment that had
 * nothing to say — the one place the bay's own silence rule is wrong.
 */

describe("rows that did not fit", () => {
  test("says how many, and what to raise — by the name every bay's block uses", () => {
    const notice = overflowNotice(6)
    expect(segmentText(notice as Segment)).toBe("↳ 6 more — raise sidebarRows")
    expect(notice?.runs[0]).toMatchObject({ tone: "muted", dim: true })
  })

  test("nothing dropped, nothing drawn", () => {
    expect(overflowNotice(0)).toBeUndefined()
    expect(overflowNotice(-1)).toBeUndefined()
  })

  test("it is the first row to go when the column is still too small", () => {
    // Priority 0: the notice must never push out a row the user asked for.
    expect(overflowNotice(1)?.priority).toBe(0)
  })
})

describe("a module that would not load", () => {
  test("names the file, not the path: the part a sidebar has room for and the part you fix", () => {
    expect(moduleNoticeText("~/.config/opencode-cockpit/modules/mine.ts: Cannot find module 'foo'")).toBe(
      "module mine.ts: Cannot find module 'foo'",
    )
  })

  test("a sidebar example 0.9 removed says what replaced it, in a sentence that fits three rows", () => {
    const text = moduleNoticeText(`~/x/examples/sidebar-budget.ts: ${REMOVED_EXAMPLE}`)
    expect(text).toBe('sidebar-budget.ts was removed in 0.9: use "preset": "sidebar"')
    expect(noticeRows([text], 24)).toHaveLength(3)
    expect(noticeRows([text], 24).map((row) => segmentText(row).trimEnd())[2]).toBe('  "preset": "sidebar"')
  })
})

describe("the rows a notice draws", () => {
  test("`!` in the warning tone, wrapped to the column, every row its full width", () => {
    const rows = noticeRows(['settings: "statusline" is no longer read — run /cockpit-setup'], 24)
    expect(rows.map((row) => segmentText(row).trimEnd())).toEqual([
      '! settings: "statusline"',
      "  is no longer read —",
      "  run /cockpit-setup",
    ])
    expect(rows[0]?.runs[0]).toMatchObject({ text: "! ", tone: "warning" })
    for (const row of rows) expect(segmentText(row)).toHaveLength(24)
  })

  test("a wide surface keeps a notice to one row", () => {
    expect(noticeRows(['settings: "statusline" is no longer read — run /cockpit-setup'], 120)).toHaveLength(1)
  })

  test("they outrank every segment, so a broken line still reports why", () => {
    for (const row of noticeRows(["a", "b"], 30)) expect(row.priority).toBe(1000)
  })

  test("nothing to say, nothing drawn", () => {
    expect(noticeRows([], 30)).toEqual([])
  })
})
