import { describe, expect, test } from "bun:test"
import type { Thread } from "../../src/core/model/thread.ts"
import { cardHeight, cardRows } from "../../src/core/view/card.ts"
import { rowWidth } from "../../src/core/view/rows.ts"

/**
 * Quoted, not boxed. A bordered box spends four glyphs and two columns per line saying "this is a
 * comment", leaves long empty rules across the screen, and has corners that line up with nothing in
 * a diff. A bar down the left says the same in one column, and a terminal already reads it as
 * quotation.
 */

const thread = (over: Partial<Thread> = {}): Thread => ({
  id: "rv_1",
  file: "packages/review/LICENSE",
  entries: [{ author: "you", body: "is this licence complete?", at: 1 }],
  status: "open",
  ...over,
})

const answered = thread({
  status: "resolved",
  entries: [
    { author: "you", body: "is this licence complete?", at: 1 },
    {
      author: "agent",
      body: "Yes, the MIT license is complete and correct. It includes the copyright line, the permission grant, the conditions and the warranty disclaimer.",
      at: 2,
    },
  ],
})

const text = (rows: { runs: { text: string }[] }[]) => rows.map((row) => row.runs.map((r) => r.text).join(""))
const prose = (rows: { runs: { text: string }[] }[]) =>
  text(rows).join(" ").replace(/▎/g, " ").replace(/\s+/g, " ")

describe("what a thread says", () => {
  test("every row is quoted, so it is never mistaken for code", () => {
    expect(text(cardRows(thread(), { width: 70, height: 20 })).every((row) => row.startsWith("▎"))).toBe(true)
  })

  test("what it is about on the left, where it stands on the right", () => {
    const first = text(
      cardRows(thread({ line: 41 }), { width: 70, height: 20 }, false, { inline: true }),
    )[0] as string
    expect(first).toContain("line 41")
    expect(first).toContain("waiting")
  })

  test("inline it does not repeat the file it is already inside", () => {
    const first = text(
      cardRows(thread({ line: 41 }), { width: 70, height: 20 }, false, { inline: true }),
    )[0] as string
    expect(first).not.toContain("LICENSE")
  })

  test("a thread the agent answered is your turn; a resolved one says so", () => {
    expect(text(cardRows(thread({ status: "answered" }), { width: 70, height: 20 }))[0]).toContain(
      "your turn",
    )
    expect(text(cardRows(answered, { width: 70, height: 20 }))[0]).toContain("resolved")
  })

  test("a thread whose code has moved says so", () => {
    expect(text(cardRows(thread(), { width: 70, height: 20 }, true))[0]).toContain("moved")
  })

  test("shows both sides of the conversation, in full", () => {
    const said = prose(cardRows(answered, { width: 70, height: 20 }))
    expect(said).toContain("is this licence complete?")
    expect(said).toContain("warranty disclaimer")
    expect(said).toContain("you")
    expect(said).toContain("agent")
  })

  /** An author on a line of its own doubles the height of a two-sentence thread. */
  test("the author sits beside its first line, not above it", () => {
    const rows = text(cardRows(thread(), { width: 70, height: 20 }))
    expect(rows[1]).toContain("you")
    expect(rows[1]).toContain("is this licence complete?")
  })

  test("only the thread under the cursor says what you can do to it", () => {
    expect(prose(cardRows(thread(), { width: 70, height: 20 }))).not.toContain("r reply")
    expect(prose(cardRows(thread(), { width: 70, height: 20 }, false, { focused: true }))).toContain(
      "r reply",
    )
  })
})

describe("in the room it has", () => {
  test("is as tall as its conversation, and no taller", () => {
    expect(cardHeight(thread(), { width: 70, height: 40 })).toBe(2)
    expect(cardHeight(answered, { width: 70, height: 40 })).toBeGreaterThan(3)
  })

  test("nothing draws wider than the width it was given, at any size", () => {
    for (const width of [24, 40, 70, 120]) {
      for (const row of cardRows(answered, { width, height: 12 }, true, { focused: true })) {
        expect(rowWidth(row)).toBeLessThanOrEqual(width)
      }
    }
  })

  test("long prose wraps under its author rather than running off", () => {
    const rows = text(cardRows(answered, { width: 60, height: 20 }))
    expect(rows.length).toBeGreaterThan(4)
    expect(rows.every((row) => row.length <= 60)).toBe(true)
  })
})
