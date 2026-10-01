import { describe, expect, test } from "bun:test"
import { toHunks } from "../../src/core/diff/hunks.ts"
import { emptyReview } from "../../src/core/model/review.ts"
import { diffRows, mostShift } from "../../src/core/view/diff.ts"
import { rowWidth } from "../../src/core/view/rows.ts"
import { displayText, hunkWhitespace } from "../../src/core/view/whitespace.ts"

/**
 * `−const a = 1` above `+const a = 1` is two identical rows and no explanation. Where whitespace is
 * the change it has to be drawn, and only there — a whole file of dots hides the code it is about.
 */

const change = (before: string, after: string) => ({
  path: "a.ts",
  before,
  after,
  additions: 1,
  deletions: 1,
})

const text = (rows: { runs: { text: string }[] }[]) => rows.map((row) => row.runs.map((r) => r.text).join(""))

const only = (before: string, after: string) => {
  const [hunk] = toHunks(before, after)
  return hunk ? hunkWhitespace(hunk).only : undefined
}

describe("a whitespace-only change", () => {
  test("shows the space that was added, and only that space", () => {
    const rows = text(diffRows(change("const a = 1\n", "const a = 1 \n"), emptyReview(), { context: 3 }, 60))
    expect(rows.some((row) => row.includes("−const a = 1 "))).toBe(true)
    expect(rows.some((row) => row.includes("+const a = 1·"))).toBe(true)
    /** The spaces between the words did not change, so they are not dotted. */
    expect(rows.some((row) => row.includes("const·a"))).toBe(false)
  })

  test("says so on the hunk's header", () => {
    const rows = text(diffRows(change("const a = 1\n", "const a = 1 \n"), emptyReview(), { context: 3 }, 60))
    expect(rows.find((row) => row.startsWith("@@"))).toContain("whitespace only")
  })

  test("draws a tab as an arrow at its stop, and spaces as dots", () => {
    const rows = text(
      diffRows(change("if (x) {\n    go()\n}\n", "if (x) {\n\tgo()\n}\n"), emptyReview(), {}, 60),
    )
    expect(rows.some((row) => row.includes("−····go()"))).toBe(true)
    expect(rows.some((row) => row.includes("+→   go()"))).toBe(true)
  })

  test("marks a carriage return that came or went", () => {
    const rows = text(diffRows(change("one = 1\r\n", "one = 1\n"), emptyReview(), {}, 60))
    expect(rows.some((row) => row.includes("−one = 1␍"))).toBe(true)
    expect(rows.find((row) => row.startsWith("@@"))).toContain("whitespace only")
  })

  test("a spacing change between tokens is still only whitespace", () => {
    expect(only("a=1\n", "a = 1\n")).toBe(true)
  })

  test("a real edit is not called whitespace, even beside one", () => {
    expect(only("const a = 1\n", "const a = 2 \n")).toBe(false)
    expect(only("one\n", "one\ntwo\n")).toBe(false)
    expect(only("one\ntwo\n", "one \n")).toBe(false)
  })
})

describe("whitespace on changed lines", () => {
  test("trailing spaces on an edited line are shown", () => {
    const rows = text(diffRows(change("a = 1\n", "a = 2  \n"), emptyReview(), {}, 60))
    expect(rows.some((row) => row.includes("+a = 2··"))).toBe(true)
  })

  test("context lines are left alone", () => {
    const rows = text(diffRows(change("keep  \nold\n", "keep  \nnew\n"), emptyReview(), {}, 60))
    expect(rows.some((row) => row.includes("keep··"))).toBe(false)
  })
})

describe("characters a row cannot carry raw", () => {
  test("a tab is expanded to its stop and a carriage return dropped, marked or not", () => {
    expect(displayText("\tx").text).toBe("    x")
    expect(displayText("ab\tx").text).toBe("ab  x")
    expect(displayText("x\r").text).toBe("x")
  })

  test("so a file indented with tabs keeps the grid", () => {
    const file = change("func a() {\n\treturn 1\n}\r\n", "func a() {\n\treturn 2\n}\r\n")
    for (const width of [44, 60, 100])
      for (const row of diffRows(file, emptyReview(), {}, width)) {
        expect(rowWidth(row)).toBe(width)
        expect(row.runs.some((run) => /[\t\r]/.test(run.text))).toBe(false)
      }
  })

  test("and scrolling sideways reaches the end of a tabbed line", () => {
    const long = `\t\t${"x".repeat(60)}\n`
    expect(mostShift(change("", long), 50)).toBe(
      mostShift(change("", `${" ".repeat(8)}${"x".repeat(60)}\n`), 50),
    )
  })
})
