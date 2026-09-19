import { describe, expect, test } from "bun:test"
import { fit, lineWidth } from "../src/core/render.ts"
import { type Segment, segmentText } from "../src/core/segments.ts"

const seg = (id: string, text: string, priority: number): Segment => ({
  id,
  runs: [{ text, tone: "muted" }],
  priority,
})

const SEP = " · "

describe("measuring a line", () => {
  test("counts the separators between segments, not after them", () => {
    expect(lineWidth([], SEP)).toBe(0)
    expect(lineWidth([seg("a", "abc", 1)], SEP)).toBe(3)
    expect(lineWidth([seg("a", "abc", 1), seg("b", "de", 1)], SEP)).toBe(3 + 3 + 2)
  })
})

describe("fitting to a narrow terminal", () => {
  const line = [
    seg("ctx", "82% ctx", 90),
    seg("cwd", "packages/status", 80),
    seg("branch", "status-bay", 70),
    seg("version", "v0.2.2", 10),
  ]

  test("a line that fits is left exactly as written", () => {
    const out = fit(line, 200, SEP)
    expect(out.segments).toEqual(line)
    expect(out.dropped).toBe(0)
  })

  /**
   * The whole point: what survives is chosen by importance, not by where it happened to sit. A
   * hard right-cut would keep the version and lose how full the context is.
   */
  test("the least important go first, and the order of the rest is kept", () => {
    const out = fit(line, 30, SEP)
    expect(out.segments.map((s) => s.id)).toEqual(["ctx", "cwd"])
    expect(out.dropped).toBe(2)
    expect(lineWidth(out.segments, SEP)).toBeLessThanOrEqual(30)
  })

  test("it drops no more than it has to", () => {
    const out = fit(line, 45, SEP)
    expect(out.segments.map((s) => s.id)).toEqual(["ctx", "cwd", "branch"])
  })

  test("equal priorities give way from the right, so written order still decides", () => {
    const even = [seg("a", "aaaa", 50), seg("b", "bbbb", 50), seg("c", "cccc", 50)]
    expect(fit(even, 11, SEP).segments.map((s) => s.id)).toEqual(["a", "b"])
  })

  test("a single segment wider than the terminal is cut, not dropped", () => {
    const out = fit([seg("only", "a-very-long-path-indeed", 50)], 8, SEP)
    expect(out.segments).toHaveLength(1)
    expect(segmentText(out.segments[0] as Segment)).toBe("a-very-…")
    expect(segmentText(out.segments[0] as Segment)).toHaveLength(8)
  })

  test("when nothing fits, the most important one survives, cut to width", () => {
    const out = fit(line, 5, SEP)
    expect(out.segments).toHaveLength(1)
    expect(out.segments[0]?.id).toBe("ctx")
    expect(segmentText(out.segments[0] as Segment)).toHaveLength(5)
  })

  // A zero-width frame happens while the terminal is being resized.
  test("no width means no line rather than a crash", () => {
    expect(fit(line, 0, SEP).segments).toEqual([])
    expect(fit([], 80, SEP).segments).toEqual([])
  })

  test("the survivors always fit the width they were given", () => {
    for (let width = 1; width <= 60; width++) {
      const out = fit(line, width, SEP)
      expect(lineWidth(out.segments, SEP)).toBeLessThanOrEqual(width)
    }
  })
})
