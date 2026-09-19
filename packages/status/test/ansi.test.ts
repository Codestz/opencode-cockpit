import { describe, expect, test } from "bun:test"
import { parseAnsi, parseAnsiLines } from "../src/core/ansi.ts"

/**
 * The point of parsing rather than stripping: a statusline someone already tuned for Claude Code
 * keeps the colours its author chose, without a line of it changing.
 */

const ESC = String.fromCharCode(27)
const sgr = (code: string) => `${ESC}[${code}m`

describe("plain text", () => {
  test("comes back as one muted run", () => {
    expect(parseAnsi("hello")).toEqual([{ text: "hello", tone: "muted" }])
  })

  test("an empty line has nothing to draw", () => {
    expect(parseAnsi("")).toEqual([])
    expect(parseAnsi(sgr("32"))).toEqual([])
  })
})

describe("the basic sixteen", () => {
  // Mapped to tones rather than literals, so a ported script still follows the user's theme.
  test("become tones, not hard-coded colours", () => {
    const runs = parseAnsi(`${sgr("32")}ok${sgr("0")} ${sgr("31")}bad`)
    expect(runs).toEqual([
      { text: "ok", tone: "success" },
      { text: " ", tone: "muted" },
      { text: "bad", tone: "error" },
    ])
  })

  test("bright variants map to the same tones", () => {
    expect(parseAnsi(`${sgr("92")}x`)[0]?.tone).toBe("success")
    expect(parseAnsi(`${sgr("90")}x`)[0]?.tone).toBe("muted")
  })
})

describe("true colour", () => {
  // What the good scripts use: a gradient bar is 24-bit per cell.
  test("38;2;r;g;b becomes that exact colour", () => {
    const runs = parseAnsi(`${sgr("38;2;46;204;113")}█`)
    expect(runs[0]).toEqual({ text: "█", color: "#2ecc71" })
  })

  test("a background is carried too", () => {
    const runs = parseAnsi(`${sgr("48;2;26;27;38")}${sgr("38;2;255;255;255")}x`)
    expect(runs[0]?.bg).toBe("#1a1b26")
    expect(runs[0]?.color).toBe("#ffffff")
  })
})

describe("the 256 palette", () => {
  test("cube entries resolve to their real colour", () => {
    expect(parseAnsi(`${sgr("38;5;196")}x`)[0]?.color).toBe("#ff0000")
    expect(parseAnsi(`${sgr("38;5;208")}x`)[0]?.color).toBe("#ff8700")
  })

  test("the grey ramp resolves to grey", () => {
    expect(parseAnsi(`${sgr("38;5;244")}x`)[0]?.color).toBe("#808080")
  })
})

describe("attributes", () => {
  test("bold and dim are carried, and 22 clears them", () => {
    const runs = parseAnsi(`${sgr("1")}a${sgr("22")}b${sgr("2")}c`)
    expect(runs[0]).toMatchObject({ text: "a", bold: true })
    expect(runs[1]?.bold).toBeUndefined()
    expect(runs[2]).toMatchObject({ text: "c", dim: true })
  })

  test("a reset clears everything, and a bare escape is a reset", () => {
    const runs = parseAnsi(`${sgr("1;38;2;1;2;3")}a${sgr("")}b`)
    expect(runs[0]).toMatchObject({ bold: true, color: "#010203" })
    expect(runs[1]).toEqual({ text: "b", tone: "muted" })
  })

  test("styles combine across one escape", () => {
    const [run] = parseAnsi(`${sgr("1;32")}x`)
    expect(run).toEqual({ text: "x", tone: "success", bold: true })
  })

  test("39 returns the foreground to the default", () => {
    const runs = parseAnsi(`${sgr("31")}a${sgr("39")}b`)
    expect(runs[1]).toEqual({ text: "b", tone: "muted" })
  })
})

describe("several rows", () => {
  // Claude Code statuslines print one row per echo, and dropping all but the first loses half
  // of a two-row design.
  test("each row is parsed on its own, and blank ones are dropped", () => {
    const rows = parseAnsiLines(`${sgr("32")}top\r\n\n${sgr("31")}bottom\n`)
    expect(rows).toHaveLength(2)
    expect(rows[0]?.[0]).toMatchObject({ text: "top", tone: "success" })
    expect(rows[1]?.[0]).toMatchObject({ text: "bottom", tone: "error" })
  })
})

describe("a real statusline", () => {
  /** The shape the reference implementations actually emit. */
  test("a gradient bar keeps a distinct colour per cell", () => {
    const cells = ["46;204;113", "116;195;89", "186;186;64", "241;196;15"]
      .map((rgb) => `${sgr(`38;2;${rgb}`)}█`)
      .join("")
    const runs = parseAnsi(`${cells}${sgr("38;5;240")}░░ ${sgr("38;2;46;204;113")}42%`)
    const colours = runs.map((run) => run.color)
    expect(new Set(colours.slice(0, 4)).size).toBe(4)
    expect(runs.at(-1)).toMatchObject({ text: "42%", color: "#2ecc71" })
  })

  test("a dim pipe separator survives as a dim run", () => {
    const runs = parseAnsi(`a ${sgr("2")}|${sgr("0")} b`)
    expect(runs[1]).toMatchObject({ text: "|", dim: true })
  })
})
