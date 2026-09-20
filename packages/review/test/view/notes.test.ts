import { describe, expect, test } from "bun:test"
import { emptyReview, open } from "../../src/core/model/review.ts"
import type { Thread } from "../../src/core/model/thread.ts"
import { diffRows } from "../../src/core/view/layout.ts"
import { noteRows } from "../../src/core/view/note.ts"
import { rowWidth } from "../../src/core/view/rows.ts"

const file = {
  path: "a.ts",
  before: "one\ntwo\nthree\nfour\n",
  after: "one\nTWO\nthree\nfour\n",
  additions: 1,
  deletions: 1,
}

const thread = (over: Partial<Thread> = {}): Thread => ({
  id: "rv_1",
  file: "a.ts",
  line: 2,
  entries: [{ author: "you", body: "why is this here?", at: 1 }],
  status: "open",
  ...over,
})

const text = (rows: { runs: { text: string }[] }[]) => rows.map((row) => row.runs.map((r) => r.text).join(""))

describe("where a thread lands in the diff", () => {
  test("drawn immediately under the line it is about", () => {
    const review = open(emptyReview(), { file: "a.ts", line: 2 }, "here")
    const rows = text(diffRows(file, review, { context: 3 }, 80))
    expect(rows.findIndex((row) => row.includes("line 2"))).toBe(
      rows.findIndex((row) => row.includes("TWO")) + 1,
    )
  })

  test("a thread about a range is drawn under the last line it covers", () => {
    const review = open(emptyReview(), { file: "a.ts", line: 1, through: 3 }, "all three")
    const rows = text(diffRows(file, review, { context: 3 }, 80))
    expect(rows.findIndex((row) => row.includes("lines 1–3"))).toBe(
      rows.findIndex((row) => row.includes("three")) + 1,
    )
  })
})

describe("how a thread reads", () => {
  test("says what it is about and who it is waiting on", () => {
    const rows = text(noteRows(thread(), 60))
    expect(rows[0]).toContain("line 2")
    expect(rows[0]).toContain("open")
  })

  test("an answered thread says it is your turn", () => {
    const answered = thread({
      status: "answered",
      entries: [
        { author: "you", body: "why?", at: 1 },
        { author: "agent", body: "because the caller holds the lock", at: 2 },
      ],
    })
    const rows = text(noteRows(answered, 60))
    expect(rows[0]).toContain("your turn")
    expect(rows.join("\n")).toContain("agent")
    expect(rows.join("\n")).toContain("because the caller holds the lock")
  })

  /** The point of resolving something is to stop reading it. */
  test("a resolved thread collapses to one line", () => {
    const rows = noteRows(thread({ status: "resolved" }), 60)
    expect(rows).toHaveLength(1)
    expect(text(rows)[0]).toContain("resolved")
  })

  test("a collapsed thread still says which line it was about, so the discussion is findable", () => {
    expect(text(noteRows(thread({ status: "resolved" }), 60))[0]).toContain("line 2")
  })

  test("a drifted thread says so rather than citing a line it no longer trusts", () => {
    expect(text(noteRows(thread(), 60, { drifted: true }))[0]).toContain("moved")
  })

  test("the focused thread shows its keys, and an unfocused one does not", () => {
    expect(text(noteRows(thread(), 60, { focused: true })).join("")).toContain("reply")
    expect(text(noteRows(thread(), 60)).join("")).not.toContain("reply")
  })

  test("long prose wraps instead of being cut off", () => {
    const long = thread({ entries: [{ author: "you", body: "word ".repeat(40).trim(), at: 1 }] })
    expect(noteRows(long, 60).length).toBeGreaterThan(4)
  })

  test("nothing draws wider than the width it was given, at any size", () => {
    for (const width of [24, 40, 60, 100, 200]) {
      for (const each of [thread(), thread({ status: "resolved" }), thread({ line: undefined })]) {
        for (const row of noteRows(each, width, { focused: true })) {
          expect(rowWidth(row)).toBeLessThanOrEqual(width)
        }
      }
    }
  })
})
