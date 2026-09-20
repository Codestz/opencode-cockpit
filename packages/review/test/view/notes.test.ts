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

describe("a finished thread you want to read again", () => {
  const resolved = thread({
    status: "resolved",
    entries: [
      { author: "you", body: "is this licence complete?", at: 1 },
      {
        author: "agent",
        body: "Yes, the MIT license is complete and correct. It includes the grant, the conditions, the warranty disclaimer and the limitation of liability.",
        at: 2,
      },
    ],
  })

  test("folds to one line, and says how to open it", () => {
    const rows = noteRows(resolved, 80)
    expect(rows).toHaveLength(1)
    expect(text(rows)[0]).toContain("o opens")
  })

  test("opened, it shows the whole answer rather than a line of it", () => {
    const rows = text(noteRows(resolved, 80, { collapsed: false }))
    /** Prose wraps, so the words are read back without the box drawing between them. */
    const prose = rows
      .map((row) => row.replace(/[│╭╮╰╯─┃┏┓┗┛]/g, " "))
      .join(" ")
      .replace(/\s+/g, " ")
    expect(prose).toContain("limitation of liability")
    expect(rows.length).toBeGreaterThan(3)
  })

  test("the folded line still says which line and that it is resolved", () => {
    const line = text(noteRows(resolved, 80))[0] as string
    expect(line).toContain("line 2")
    expect(line).toContain("resolved")
  })
})

describe("a thread about the whole file", () => {
  test("is drawn under the file's heading, before any line of it", () => {
    const review = open(emptyReview(), { file: "a.ts" }, "about all of it")
    const rows = text(diffRows(file, review, { context: 3 }, 80))
    const noteAt = rows.findIndex((row) => row.includes("whole file"))
    const firstLine = rows.findIndex((row) => row.includes("one"))
    expect(noteAt).toBeGreaterThan(0)
    expect(noteAt).toBeLessThan(firstLine)
  })

  /**
   * It lives on no line, so it can never be under a line cursor — which is how it became possible to
   * write one and then never open it again.
   */
  test("carries its id so something other than a line cursor can find it", () => {
    const review = open(emptyReview(), { file: "a.ts" }, "about all of it")
    const id = review.threads[0]?.id
    const rows = diffRows(file, review, { context: 3 }, 80)
    expect(rows.some((row) => row.target === id)).toBe(true)
  })
})

describe("folding", () => {
  /** `noteRows` is told whether to fold; deciding is the caller's job, and it is tested there. */
  test("a resolved thread folds unless it is told not to", () => {
    const resolved = thread({ status: "resolved" })
    expect(noteRows(resolved, 80)).toHaveLength(1)
    expect(noteRows(resolved, 80, { collapsed: false }).length).toBeGreaterThan(1)
  })

  test("an unfinished thread is open unless it is told to fold", () => {
    const answered = thread({ status: "answered" })
    expect(noteRows(answered, 80).length).toBeGreaterThan(1)
    expect(noteRows(answered, 80, { collapsed: true })).toHaveLength(1)
  })
})

describe("what the diff decides about folding", () => {
  const resolved = () => {
    const review = open(emptyReview(), { file: "a.ts", line: 2 }, "is this right?")
    const id = review.threads[0]?.id as string
    return {
      review: { ...review, threads: [{ ...(review.threads[0] as never), status: "resolved" as const }] },
      id,
    }
  }

  test("a resolved thread folds away, so a finished review reads as quiet", () => {
    const { review } = resolved()
    expect(text(diffRows(file, review, { context: 3 }, 80)).some((row) => row.includes("o opens"))).toBe(true)
  })

  test("the thread under the cursor is open, because you are looking at it", () => {
    const { review, id } = resolved()
    const rows = text(diffRows(file, review, { context: 3, thread: id }, 80))
    expect(rows.some((row) => row.includes("is this right?"))).toBe(true)
  })

  /**
   * The rule that broke `o`: it acts on the focused thread, and focus already forced that one open,
   * so a set of "opened" threads could never change anything. An explicit choice has to win.
   */
  test("folding it by hand wins over the focus that opened it", () => {
    const { review, id } = resolved()
    const rows = text(
      diffRows(file, review, { context: 3, thread: id, unfolded: new Map([[id, false]]) }, 80),
    )
    /**
     * Folded means one line carrying a preview of what was said, not the absence of the words — so
     * the box is what to look for, and a folded thread has none.
     */
    expect(rows.some((row) => row.includes("╭") || row.includes("┏"))).toBe(false)
    expect(rows.some((row) => row.includes("o opens"))).toBe(true)
  })

  test("opening one by hand wins over the fold that hid it", () => {
    const { review, id } = resolved()
    const rows = text(diffRows(file, review, { context: 3, unfolded: new Map([[id, true]]) }, 80))
    expect(rows.some((row) => row.includes("is this right?"))).toBe(true)
  })
})
