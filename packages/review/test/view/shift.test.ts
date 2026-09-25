import { describe, expect, test } from "bun:test"
import { emptyReview } from "../../src/core/model/review.ts"
import { codeWidth, diffRows, mostShift } from "../../src/core/view/diff.ts"

/** A line longer than the pane can be read by scrolling the code sideways; the gutter stays. */
describe("scrolling the code sideways", () => {
  const long = `const x = ${"a".repeat(120)} // END`
  const file = { path: "a.ts", before: "", after: `${long}\n`, additions: 1, deletions: 0 }
  const text = (shift: number) =>
    (diffRows(file, emptyReview(), { shift }, 60).find((row) => row.line === 1)?.runs ?? [])
      .map((run) => run.text)
      .join("")

  test("unscrolled, the line is cut at the pane's edge", () => {
    expect(text(0)).toContain("const x =")
    expect(text(0)).not.toContain("// END")
  })

  test("scrolled as far as it goes, the end of the longest line is in view — and the numbers stay", () => {
    const most = mostShift(file, 60)
    expect(most).toBe(long.length - codeWidth(60) + 1)
    const end = text(most)
    expect(end).toContain("// END")
    expect(end).not.toContain("const x =")
    expect(end).toMatch(/^\s+1 \+/)
  })

  test("every row keeps the pane's width", () => {
    for (const shift of [0, 7, mostShift(file, 60)]) {
      for (const row of diffRows(file, emptyReview(), { shift }, 60))
        expect(row.runs.map((run) => run.text).join("").length).toBe(60)
    }
  })
})
