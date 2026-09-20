import { describe, expect, test } from "bun:test"
import { moduleNotice, overflowNotice } from "../src/core/notices.ts"
import { type Segment, segmentText } from "../src/core/segments.ts"

/**
 * Both of these exist because a failure that draws nothing is indistinguishable from a segment that
 * had nothing to say — the one place the bay's own silence rule is wrong.
 */

describe("rows that did not fit", () => {
  test("says how many, and what to raise", () => {
    const notice = overflowNotice(6)
    expect(segmentText(notice as Segment)).toBe("↳ 6 more — raise maxRows")
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
  test("names the one that failed, because the name is what you go and fix", () => {
    const notice = moduleNotice(["./mine.ts: Cannot find module 'foo'"])
    expect(segmentText(notice as Segment)).toContain("./mine.ts")
    expect(notice?.runs[0]?.tone).toBe("error")
  })

  test("a long message is cut to fit a sidebar column", () => {
    const notice = moduleNotice([`./x.ts: ${"very ".repeat(40)}long`], 30)
    expect(segmentText(notice as Segment).length).toBeLessThanOrEqual(32)
  })

  test("several are counted rather than listed, which would fill the line", () => {
    expect(segmentText(moduleNotice(["a", "b", "c"]) as Segment)).toBe("⚠ 3 modules failed to load")
  })

  test("it outranks every segment, so a broken line still reports why", () => {
    expect(moduleNotice(["a"])?.priority).toBe(1000)
  })

  test("nothing failed, nothing drawn", () => {
    expect(moduleNotice([])).toBeUndefined()
  })
})
