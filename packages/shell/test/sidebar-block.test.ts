import { describe, expect, test } from "bun:test"
import { EMPTY_TEXT } from "@opencode-cockpit/client/design"
import { SAMPLE_LIST, SAMPLE_NOW, SHELLS } from "../src/cli/samples.ts"
import type { Row } from "../src/tui/lib/console.ts"
import { sidebarBlock } from "../src/tui/lib/sidebar.ts"

const text = (row: Row) => row.map((run) => run.text).join("")
const block = (list = SAMPLE_LIST, width = 36, showAll = false) =>
  sidebarBlock({ list, now: SAMPLE_NOW, frame: 0, width, showAll })

describe("the Shells block, as rows of tones", () => {
  test("every row is exactly its width", () => {
    for (const width of [24, 30, 36, 48])
      for (const showAll of [false, true])
        for (const row of block(SAMPLE_LIST, width, showAll)) expect(text(row).length).toBe(width)
  })

  test("the heading names the block and counts every state, flush right", () => {
    const heading = text(block()[0])
    expect(heading.startsWith("Shells")).toBe(true)
    expect(heading.trimEnd()).toMatch(/running/)
  })

  test("folded: what still needs a look, then `+ N more`; expanded: all of them and `− fewer`", () => {
    const folded = block().map(text)
    expect(folded.at(-1)).toMatch(/\+ \d+ more/)
    expect(folded.some((row) => row.includes("DONE"))).toBe(false)
    const open = block(SAMPLE_LIST, 36, true).map(text)
    expect(open.some((row) => row.includes("DONE"))).toBe(true)
  })

  test("a state is a tone, not a colour: a failed shell's mark is the error tone", () => {
    const failed = block([SHELLS.failed]).find((row) => text(row).includes("FAIL"))
    expect(failed?.find((run) => run.text.includes("FAIL"))?.tone).toBe("error")
    expect(failed?.some((run) => run.fg !== undefined)).toBe(false)
  })

  test("empty: the client's block — heading, its row of air, `none yet`", () => {
    expect(block([]).map((row) => text(row).trim())).toEqual(["Shells", "", EMPTY_TEXT])
  })
})
