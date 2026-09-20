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

describe("what is tinted", () => {
  /**
   * Three tints, the way a pull request does it: the gutter loudly, the row faintly, and a
   * conversation on a surface of its own. One tint for all three made a file of pure additions read
   * as a green field with text on it, and left a comment nothing to stand out against.
   */
  const added = () =>
    diffRows(file, emptyReview(), { context: 3 }, 80).find((row) =>
      row.runs.some((run) => run.text.includes("TWO")),
    )

  test("a changed line's gutter is tinted apart from the rest of the row", () => {
    const runs = added()?.runs ?? []
    expect(runs.some((run) => run.fill === "addedNumber")).toBe(true)
    expect(runs.some((run) => run.fill === "added")).toBe(true)
  })

  test("a removed line uses the other side's tints, never the added ones", () => {
    const removed = diffRows(file, emptyReview(), { context: 3 }, 80).find((row) =>
      row.runs.some((run) => run.text.includes("two")),
    )
    expect(removed?.runs.some((run) => run.fill === "removedNumber")).toBe(true)
    expect(removed?.runs.some((run) => run.fill === "added")).toBe(false)
  })

  test("an unchanged line is tinted by nothing at all", () => {
    const context = diffRows(file, emptyReview(), { context: 3 }, 80).find((row) =>
      row.runs.some((run) => run.text.includes("three")),
    )
    expect(context?.runs.every((run) => run.fill === undefined || run.fill === "none")).toBe(true)
  })

  test("a comment sits on a surface belonging to neither side of the diff", () => {
    const review = open(emptyReview(), { file: "a.ts", line: 2 }, "why?")
    const said = diffRows(file, review, { context: 3 }, 80).find((row) =>
      row.runs.some((run) => run.text.includes("why?")),
    )
    expect(said?.runs.some((run) => run.fill === "comment")).toBe(true)
    expect(said?.runs.some((run) => run.fill === "added" || run.fill === "removed")).toBe(false)
  })
})

describe("counting changes", () => {
  test("a file that deleted nothing does not say so", () => {
    const created = { ...file, before: "", additions: 4, deletions: 0 }
    expect(text(diffRows(created, emptyReview(), { context: 3 }, 80))[0]).not.toContain("−0")
  })

  test("a file that added nothing does not say so either", () => {
    const deleted = { path: "a.ts", before: "gone\n", after: "", additions: 0, deletions: 1 }
    expect(text(diffRows(deleted, emptyReview(), { context: 3 }, 80))[0]).not.toContain("+0")
  })

  test("a file that did both says both", () => {
    const heading = text(diffRows(file, emptyReview(), { context: 3 }, 80))[0] as string
    expect(heading).toContain("+1")
    expect(heading).toContain("−1")
  })
})

describe("the comment band", () => {
  /**
   * Unfilled, the indent punched a black hole through the tinted diff to the left of every
   * conversation — a gap with text beside it rather than one surface.
   */
  test("reaches the margin, so it reads as one surface", () => {
    const review = open(emptyReview(), { file: "a.ts", line: 2 }, "why?")
    const said = diffRows(file, review, { context: 3 }, 80).find((row) =>
      row.runs.some((run) => run.text.includes("why?")),
    )
    expect(said?.runs.every((run) => run.fill === "comment")).toBe(true)
  })

  test("and spans the full width of the column it is drawn in", () => {
    const review = open(emptyReview(), { file: "a.ts", line: 2 }, "why?")
    for (const width of [50, 80, 120]) {
      const said = diffRows(file, review, { context: 3 }, width).find((row) =>
        row.runs.some((run) => run.text.includes("why?")),
      )
      expect(rowWidth(said ?? { runs: [] })).toBe(width)
    }
  })
})
