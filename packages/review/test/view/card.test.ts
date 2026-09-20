import { describe, expect, test } from "bun:test"
import type { Thread } from "../../src/core/model/thread.ts"
import { cardHeight, cardRows, floatOver } from "../../src/core/view/card.ts"
import { rowWidth } from "../../src/core/view/rows.ts"

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
      body: "Yes, the MIT license is complete and correct. It includes the copyright line, the permission grant, the conditions, the warranty disclaimer and the limitation of liability.",
      at: 2,
    },
  ],
})

const text = (rows: { runs: { text: string }[] }[]) => rows.map((row) => row.runs.map((r) => r.text).join(""))
const prose = (rows: { runs: { text: string }[] }[]) =>
  text(rows)
    .map((row) => row.replace(/[│╭╮╰╯·─]/g, " "))
    .join(" ")
    .replace(/\s+/g, " ")

describe("what a card says", () => {
  test("names the file and the lines, and who it is waiting on", () => {
    const rows = text(cardRows(thread({ line: 41 }), { width: 70, height: 20 }))
    expect(rows[0]).toContain("LICENSE")
    expect(rows[0]).toContain("line 41")
    expect(rows[0]).toContain("waiting")
  })

  test("a thread the agent answered is your turn", () => {
    const rows = text(cardRows(thread({ status: "answered" }), { width: 70, height: 20 }))
    expect(rows[0]).toContain("your turn")
  })

  /** The whole reason for a card: the answer is readable, not a line of it. */
  test("shows the whole conversation, both sides", () => {
    const said = prose(cardRows(answered, { width: 70, height: 20 }))
    expect(said).toContain("is this licence complete?")
    expect(said).toContain("limitation of liability")
    expect(said).toContain("you")
    expect(said).toContain("agent")
  })

  test("says what you can do about it", () => {
    expect(prose(cardRows(thread(), { width: 70, height: 20 }))).toContain("r reply")
    expect(prose(cardRows(thread(), { width: 70, height: 20 }))).toContain("esc close")
  })

  test("a thread whose code has moved says so", () => {
    expect(text(cardRows(thread({ line: 4 }), { width: 70, height: 20 }, true))[0]).toContain("moved")
  })
})

describe("a card in the room it has", () => {
  test("is as tall as its conversation, not as tall as the pane", () => {
    expect(cardHeight(thread(), { width: 70, height: 40 })).toBeLessThan(10)
  })

  test("never taller than what it was offered", () => {
    expect(cardHeight(answered, { width: 40, height: 8 })).toBeLessThanOrEqual(8)
  })

  /** The last thing said is the thing you opened it to read, so the top is what gives way. */
  test("a conversation too long for the room keeps its end, and says what it hid", () => {
    const long = thread({
      entries: Array.from({ length: 20 }, (_, index) => ({
        author: "you" as const,
        body: `thought number ${index}`,
        at: index,
      })),
    })
    const said = prose(cardRows(long, { width: 60, height: 10 }))
    expect(said).toContain("thought number 19")
    expect(said).toContain("earlier lines")
  })

  test("nothing draws wider than the card, at any size", () => {
    for (const width of [24, 40, 70, 120]) {
      for (const row of cardRows(answered, { width, height: 12 })) {
        expect(rowWidth(row)).toBeLessThanOrEqual(width)
      }
    }
  })
})

describe("floating it over what is underneath", () => {
  const base = Array.from({ length: 11 }, (_, index) => ({ runs: [{ text: `line ${index}`.padEnd(30) }] }))

  test("sits in the middle, leaving what is above and below alone", () => {
    const card = [{ runs: [{ text: "CARD" }] }]
    const out = text(floatOver(base, card, 30))
    expect(out[5]).toContain("CARD")
    expect(out[0]).toContain("line 0")
    expect(out.at(-1)).toContain("line 10")
  })

  test("a card as tall as the pane still fits inside it", () => {
    const card = Array.from({ length: 11 }, () => ({ runs: [{ text: "CARD" }] }))
    expect(floatOver(base, card, 30)).toHaveLength(11)
  })
})
