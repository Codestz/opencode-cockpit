import { describe, expect, test } from "bun:test"
import { emptyReview, open } from "../../src/core/model/review.ts"
import { diffRows, layout } from "../../src/core/view/layout.ts"
import { rowWidth } from "../../src/core/view/rows.ts"

/**
 * Threads used to be drawn between the lines they were about, which pushed the code around as a
 * conversation grew and squeezed prose into a diff column. A commented line is marked now, and the
 * thread is read on a card — so what the diff has to get right is the mark.
 */

const file = {
  path: "a.ts",
  before: "one\ntwo\nthree\nfour\n",
  after: "one\nTWO\nthree\nfour\n",
  additions: 1,
  deletions: 1,
}

const changes = { source: "branch" as const, files: [file] }
const text = (rows: { runs: { text: string }[] }[]) => rows.map((row) => row.runs.map((r) => r.text).join(""))

describe("a commented line", () => {
  test("is marked, and the code beside it is untouched", () => {
    const review = open(emptyReview(), { file: "a.ts", line: 2 }, "why?")
    const rows = text(diffRows(file, review, { context: 3 }, 80))
    const marked = rows.find((row) => row.includes("TWO")) as string
    expect(marked.startsWith("▐")).toBe(true)
    expect(marked).toContain("TWO")
  })

  test("an uncommented line is not marked", () => {
    const rows = text(diffRows(file, emptyReview(), { context: 3 }, 80))
    expect(rows.find((row) => row.includes("TWO"))?.startsWith("▐")).toBe(false)
  })

  /** The diff keeps its shape: a conversation of any length costs the same one column. */
  test("the diff is no taller for having threads on it", () => {
    const bare = diffRows(file, emptyReview(), { context: 3 }, 80).length
    let review = open(emptyReview(), { file: "a.ts", line: 2 }, "a".repeat(400))
    review = open(review, { file: "a.ts", line: 3 }, "another long thought, at length")
    expect(diffRows(file, review, { context: 3 }, 80)).toHaveLength(bare)
  })

  test("carries the thread's id, so a click knows what it landed on", () => {
    const review = open(emptyReview(), { file: "a.ts", line: 2 }, "why?")
    const id = review.threads[0]?.id
    const rows = diffRows(file, review, { context: 3 }, 80)
    expect(rows.some((row) => row.target === id)).toBe(true)
  })
})

describe("a thread about the whole file", () => {
  /** It sits on no line, so the file's own heading is where it can be announced and reached. */
  test("is counted on the file's heading, which carries its id", () => {
    const review = open(emptyReview(), { file: "a.ts" }, "about all of it")
    const rows = diffRows(file, review, { context: 3 }, 80)
    expect(text(rows)[0]).toContain("▐ 1")
    expect(rows[0]?.target).toBe(review.threads[0]?.id as string)
  })
})

describe("reading one", () => {
  const withThread = () => {
    const review = open(emptyReview(), { file: "a.ts", line: 2 }, "is this right?")
    return { review, id: review.threads[0]?.id as string }
  }

  test("nothing floats until a thread is opened", () => {
    const { review } = withThread()
    const rows = text(layout(changes, review, { file: "a.ts" }, { width: 100, height: 20 }))
    expect(rows.some((row) => row.includes("is this right?"))).toBe(false)
  })

  test("the card floats over the diff, showing the conversation", () => {
    const { review, id } = withThread()
    const rows = text(layout(changes, review, { file: "a.ts", reading: id }, { width: 100, height: 20 }))
    expect(rows.some((row) => row.includes("is this right?"))).toBe(true)
  })

  /** Opening a card must not move what is underneath it, or closing it would lose your place. */
  test("the screen is the same height with a card open as without", () => {
    const { review, id } = withThread()
    const without = layout(changes, review, { file: "a.ts" }, { width: 100, height: 20 })
    const with_ = layout(changes, review, { file: "a.ts", reading: id }, { width: 100, height: 20 })
    expect(with_).toHaveLength(without.length)
  })

  test("the header and the keys are never covered by it", () => {
    const { review, id } = withThread()
    const rows = text(layout(changes, review, { file: "a.ts", reading: id }, { width: 100, height: 20 }))
    expect(rows[0]).toContain("review")
    expect(rows.at(-1)).toContain("close")
  })

  test("a thread that no longer exists is not drawn, and nothing breaks", () => {
    const { review } = withThread()
    const rows = layout(changes, review, { file: "a.ts", reading: "rv_gone" }, { width: 100, height: 20 })
    expect(rows.length).toBeGreaterThan(0)
  })
})

describe("finding a thread by looking", () => {
  /**
   * A single glyph in a column of diff is not a signal — you have to already know to look for it.
   * The word is what makes a thread findable by scrolling past it, which is how anyone finds one.
   */
  test("a commented line says so in words, not just a mark", () => {
    const review = open(emptyReview(), { file: "a.ts", line: 2 }, "why?")
    const rows = text(diffRows(file, review, { context: 3 }, 80))
    expect(rows.find((row) => row.includes("TWO"))).toContain("note")
  })

  test("two threads on a line are counted", () => {
    let review = open(emptyReview(), { file: "a.ts", line: 2 }, "one")
    review = { ...review, threads: [...review.threads, { ...(review.threads[0] as never), id: "rv_2" }] }
    expect(text(diffRows(file, review, { context: 3 }, 80)).find((row) => row.includes("TWO"))).toContain(
      "2 notes",
    )
  })

  test("the badge never pushes a row past its width", () => {
    const review = open(emptyReview(), { file: "a.ts", line: 2 }, "why?")
    for (const width of [40, 60, 80, 120]) {
      for (const row of diffRows(file, review, { context: 3 }, width)) {
        expect(rowWidth(row)).toBeLessThanOrEqual(width)
      }
    }
  })

  test("a file with its own thread is counted on its heading, without losing the ratio bar", () => {
    const review = open(emptyReview(), { file: "a.ts" }, "about all of it")
    const heading = text(diffRows(file, review, { context: 3 }, 90))[0] as string
    expect(heading).toContain("▐ 1")
    expect(heading).toContain("■")
    expect(heading).not.toContain("…")
  })
})
