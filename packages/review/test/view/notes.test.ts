import { describe, expect, test } from "bun:test"
import { emptyReview, open } from "../../src/core/model/review.ts"
import { diffRows } from "../../src/core/view/layout.ts"
import { rowWidth } from "../../src/core/view/rows.ts"

/**
 * A thread is drawn under the line it is about, indented, with the code carrying on beneath it —
 * which is where a pull request puts a comment and where the eye expects to find one.
 *
 * It was briefly a card floating over the diff. That hid the code it was talking about, and made "is
 * this one open" a question with answers, which is how a key to open them ended up doing nothing.
 */

const file = {
  path: "a.ts",
  before: "one\ntwo\nthree\nfour\n",
  after: "one\nTWO\nthree\nfour\n",
  additions: 1,
  deletions: 1,
}

const text = (rows: { runs: { text: string }[] }[]) => rows.map((row) => row.runs.map((r) => r.text).join(""))

describe("a thread on a line", () => {
  test("is drawn under that line, and the code continues after it", () => {
    const review = open(emptyReview(), { file: "a.ts", line: 2 }, "why is this here?")
    const rows = text(diffRows(file, review, { context: 3 }, 80))
    const line = rows.findIndex((row) => row.includes("TWO"))
    const said = rows.findIndex((row) => row.includes("why is this here?"))
    const after = rows.findIndex((row) => row.includes("three"))
    expect(said).toBeGreaterThan(line)
    expect(after).toBeGreaterThan(said)
  })

  test("is indented, so it is not mistaken for code", () => {
    const review = open(emptyReview(), { file: "a.ts", line: 2 }, "why?")
    const rows = text(diffRows(file, review, { context: 3 }, 80))
    expect(rows.find((row) => row.includes("line 2"))?.startsWith("    ")).toBe(true)
  })

  test("its line is marked, so a thread is visible before you read it", () => {
    const review = open(emptyReview(), { file: "a.ts", line: 2 }, "why?")
    const rows = text(diffRows(file, review, { context: 3 }, 80))
    expect(rows.find((row) => row.includes("TWO"))?.startsWith("▐")).toBe(true)
  })

  test("an uncommented line is not marked", () => {
    const rows = text(diffRows(file, emptyReview(), { context: 3 }, 80))
    expect(rows.find((row) => row.includes("TWO"))?.startsWith("▐")).toBe(false)
  })

  test("says who said what, without repeating the file it is already inside", () => {
    let review = open(emptyReview(), { file: "a.ts", line: 2 }, "why?")
    const id = review.threads[0]?.id as string
    review = {
      ...review,
      threads: [
        {
          ...(review.threads[0] as never),
          id,
          status: "answered" as const,
          entries: [
            { author: "you" as const, body: "why?", at: 1 },
            { author: "agent" as const, body: "because the caller holds the lock", at: 2 },
          ],
        },
      ],
    }
    const rows = text(diffRows(file, review, { context: 3 }, 80))
    const heading = rows.find((row) => row.includes("line 2")) as string
    expect(heading).toContain("your turn")
    expect(heading).not.toContain("a.ts")
    expect(rows.join(" ")).toContain("because the caller holds the lock")
  })

  test("carries the thread's id on every row of it, so a click anywhere on it lands", () => {
    const review = open(emptyReview(), { file: "a.ts", line: 2 }, "why?")
    const id = review.threads[0]?.id
    const rows = diffRows(file, review, { context: 3 }, 80)
    expect(rows.filter((row) => row.target === id).length).toBeGreaterThan(2)
  })

  test("nothing draws wider than the column, at any size", () => {
    const review = open(emptyReview(), { file: "a.ts", line: 2 }, "a thought long enough to wrap ".repeat(4))
    for (const width of [40, 60, 80, 120]) {
      for (const row of diffRows(file, review, { context: 3 }, width)) {
        expect(rowWidth(row)).toBeLessThanOrEqual(width)
      }
    }
  })
})

describe("a thread about the whole file", () => {
  test("reads first, before any line of the file", () => {
    const review = open(emptyReview(), { file: "a.ts" }, "about all of it")
    const rows = text(diffRows(file, review, { context: 3 }, 80))
    const said = rows.findIndex((row) => row.includes("about all of it"))
    const firstLine = rows.findIndex((row) => row.includes("one"))
    expect(said).toBeGreaterThan(0)
    expect(said).toBeLessThan(firstLine)
  })

  test("is counted on the file's heading, which carries its id", () => {
    const review = open(emptyReview(), { file: "a.ts" }, "about all of it")
    const rows = diffRows(file, review, { context: 3 }, 90)
    expect(text(rows)[0]).toContain("▐ 1")
    expect(rows[0]?.target).toBe(review.threads[0]?.id as string)
  })
})
