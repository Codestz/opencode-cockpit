import { describe, expect, test } from "bun:test"
import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import type { TextRenderable } from "@opentui/core"
import { metrics } from "../../src/core/perf.ts"
import type { Row } from "../../src/core/view/rows.ts"
import { createRowPool } from "../../src/tui/render/rows.ts"

/**
 * The pool is where a frame is actually spent: composing rows measures at well under a tenth of a
 * millisecond, while every row it hands over becomes a chunk per run and a `StyledText` per line. So
 * what matters is how many lines a paint *touches*, and that is what these tests pin.
 */

/** A line that remembers what it was assigned, which is all the pool needs one to do. */
const lineOf = () => {
  const line = { content: "", visible: false, assigned: 0 } as unknown as TextRenderable & {
    assigned: number
  }
  let held: unknown = ""
  Object.defineProperty(line, "content", {
    get: () => held,
    set: (value: unknown) => {
      held = value
      line.assigned++
    },
  })
  return line
}

const theme = { text: 1, textMuted: 2, accent: 3 } as unknown as TuiThemeCurrent
const other = { text: 9, textMuted: 8, accent: 7 } as unknown as TuiThemeCurrent

const rowsOf = (texts: string[]): Row[] => texts.map((text) => ({ runs: [{ text, tone: "text" }] }))

const setup = (count = 6) => {
  const lines = Array.from({ length: count }, lineOf)
  return { lines, pool: createRowPool(lines) }
}

const touched = (run: () => void): number => {
  const before = metrics.snapshot().counts.lines
  run()
  return metrics.snapshot().counts.lines - before
}

describe("what a paint costs", () => {
  test("the first paint assigns every line it was given", () => {
    const { pool, lines } = setup()
    expect(touched(() => pool.draw(rowsOf(["a", "b", "c"]), theme))).toBe(3)
    expect(lines[0]?.assigned).toBe(1)
  })

  test("painting the same rows again assigns nothing", () => {
    const { pool, lines } = setup()
    pool.draw(rowsOf(["a", "b", "c"]), theme)
    expect(touched(() => pool.draw(rowsOf(["a", "b", "c"]), theme))).toBe(0)
    expect(lines[0]?.assigned).toBe(1)
  })

  /** The reason this exists: a scroll of one line used to rebuild the whole window. */
  test("a scroll of one line touches one line", () => {
    const { pool } = setup()
    pool.draw(rowsOf(["a", "b", "c", "d"]), theme)
    expect(touched(() => pool.draw(rowsOf(["a", "b", "c", "e"]), theme))).toBe(1)
  })

  test("a row that differs only in colour is still a different row", () => {
    const { pool } = setup()
    pool.draw([{ runs: [{ text: "a", tone: "text" }] }], theme)
    expect(touched(() => pool.draw([{ runs: [{ text: "a", tone: "accent" }] }], theme))).toBe(1)
    expect(touched(() => pool.draw([{ runs: [{ text: "a", tone: "accent", fill: "added" }] }], theme))).toBe(
      1,
    )
  })

  test("a new theme repaints everything, because every colour has changed", () => {
    const { pool } = setup()
    pool.draw(rowsOf(["a", "b", "c"]), theme)
    expect(touched(() => pool.draw(rowsOf(["a", "b", "c"]), other))).toBe(3)
  })
})

describe("lines it does not need", () => {
  test("are hidden rather than destroyed, and repaint when they come back", () => {
    const { pool, lines } = setup()
    pool.draw(rowsOf(["a", "b", "c"]), theme)
    pool.draw(rowsOf(["a"]), theme)
    expect(lines[1]?.visible).toBe(false)
    /** Forgotten, not remembered as still showing "b" — or it would never be drawn again. */
    expect(touched(() => pool.draw(rowsOf(["a", "b"]), theme))).toBe(1)
    expect(lines[1]?.visible).toBe(true)
  })

  test("clearing forgets what was on screen", () => {
    const { pool, lines } = setup()
    pool.draw(rowsOf(["a", "b"]), theme)
    pool.clear()
    expect(lines[0]?.visible).toBe(false)
    expect(touched(() => pool.draw(rowsOf(["a", "b"]), theme))).toBe(2)
  })

  test("more rows than lines is not an error; the extra ones are simply not drawn", () => {
    const { pool } = setup(2)
    expect(touched(() => pool.draw(rowsOf(["a", "b", "c", "d"]), theme))).toBe(2)
  })
})
