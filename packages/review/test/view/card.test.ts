import { describe, expect, test } from "bun:test"
import type { Thread } from "../../src/core/model/thread.ts"
import { cardHeight, cardRows } from "../../src/core/view/card.ts"
import { rowWidth } from "../../src/core/view/rows.ts"

/**
 * A band, not a box and no longer a quote bar. A box spends four glyphs and two columns per line
 * saying "this is a comment"; a bar says it in one column, but says it *beside* the conversation
 * rather than around it. A tinted row spanning the full width says it with no characters at all.
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
/** The first row that says something: a thread opens with a blank row of band for air. */
const heading = (rows: { runs: { text: string }[] }[]) =>
  text(rows).find((row) => row.replace(/▌/g, "").trim().length > 0) as string
const prose = (rows: { runs: { text: string }[] }[]) =>
  text(rows).join(" ").replace(/▌/g, " ").replace(/\s+/g, " ")
const fills = (rows: { runs: { fill?: string }[] }[]) =>
  new Set(rows.flatMap((row) => row.runs.map((run) => run.fill)))

describe("what a thread says", () => {
  test("every row is the band, so it is never mistaken for code", () => {
    const rows = cardRows(thread(), { width: 70, height: 20 })
    /** The surface is what marks it out, and it is on every run of every row. */
    expect(fills(rows)).toEqual(new Set(["comment", "you"]))
  })

  test("and no glyph does the work the surface is doing", () => {
    const said = text(cardRows(thread(), { width: 70, height: 20 })).join("")
    expect(said).not.toContain("▎")
    expect(said).not.toContain("│")
  })

  test("only the thread under the cursor carries an edge in its margin", () => {
    expect(text(cardRows(thread(), { width: 70, height: 20 })).join("")).not.toContain("▌")
    expect(text(cardRows(thread(), { width: 70, height: 20 }, false, { focused: true })).join("")).toContain(
      "▌",
    )
  })

  test("what it is about, then how it stands, as one phrase", () => {
    const first = heading(cardRows(thread({ line: 41 }), { width: 70, height: 20 }, false, { inline: true }))
    expect(first).toContain("LINE 41")
    expect(first).toContain("[WAITING]")
    /** Together, not one at each end: no void across the middle of the band. */
    expect(first.indexOf("[WAITING]") - first.indexOf("LINE 41")).toBeLessThan(20)
  })

  test("inline it does not repeat the file it is already inside", () => {
    const first = heading(cardRows(thread({ line: 41 }), { width: 70, height: 20 }, false, { inline: true }))
    expect(first).not.toContain("LICENSE")
  })

  test("a thread the agent answered is your turn; a resolved one says so", () => {
    expect(heading(cardRows(thread({ status: "answered" }), { width: 70, height: 20 }))).toContain(
      "[YOUR TURN]",
    )
    expect(heading(cardRows(answered, { width: 70, height: 20 }))).toContain("[RESOLVED]")
  })

  test("a thread whose code has moved says so", () => {
    expect(heading(cardRows(thread(), { width: 70, height: 20 }, true))).toContain("MOVED")
  })

  test("shows both sides of the conversation, in full", () => {
    const said = prose(cardRows(answered, { width: 70, height: 20 }))
    expect(said).toContain("is this licence complete?")
    expect(said).toContain("warranty disclaimer")
    expect(said).toContain("YOU")
    expect(said).toContain("AGENT")
  })

  /**
   * A badge, not a coloured word: solid-on-dark is recognised rather than read, and it costs no row
   * of its own. The tone is the panel's background, which is what makes it read as ink on a label.
   */
  test("who is speaking is a solid badge, in its own colour", () => {
    const runs = cardRows(answered, { width: 70, height: 20 }).flatMap((row) => row.runs)
    const you = runs.find((run) => run.text.includes("YOU"))
    const agent = runs.find((run) => run.text.includes("AGENT"))
    expect(you?.fill).toBe("you")
    expect(agent?.fill).toBe("agent")
    expect(you?.tone).toBe("inverse")
    expect(agent?.tone).toBe("inverse")
  })

  /** An author on a line of its own doubles the height of a two-sentence thread. */
  test("the author sits beside its first line, not above it", () => {
    const said = text(cardRows(thread(), { width: 70, height: 20 })).find((row) => row.includes("YOU"))
    expect(said).toContain("is this licence complete?")
  })

  /** Two turns start at the same character, so a conversation reads as a column of prose. */
  test("wrapped lines hang under the words, not under the badge", () => {
    const rows = text(cardRows(answered, { width: 56, height: 30 }))
    const first = rows.findIndex((row) => row.includes("AGENT"))
    const badgeAt = (rows[first] as string).indexOf("Yes,")
    const hung = rows[first + 1] as string
    expect(hung.search(/\S/)).toBe(badgeAt)
  })

  test("only the thread under the cursor says what you can do to it", () => {
    expect(prose(cardRows(thread(), { width: 70, height: 20 }))).not.toContain("[c] Reply")
    expect(prose(cardRows(thread(), { width: 70, height: 20 }, false, { focused: true }))).toContain(
      "[c] Reply",
    )
  })
})

describe("in the room it has", () => {
  test("is as tall as its conversation, and no taller", () => {
    /** Air, a heading, air, one line of prose, air. */
    expect(cardHeight(thread(), { width: 70, height: 40 })).toBe(5)
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

  /** The tint has to reach both edges, or the band reads as text with a gap beside it. */
  test("every row fills the width it was given, at any size", () => {
    for (const width of [24, 40, 70, 120]) {
      for (const row of cardRows(answered, { width, height: 12 }, true, { focused: true })) {
        expect(rowWidth(row)).toBe(width)
      }
    }
  })
})
