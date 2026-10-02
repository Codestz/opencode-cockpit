import { describe, expect, test } from "bun:test"
import { createMeter } from "../../src/core/perf.ts"
import { footerRows } from "../../src/core/view/chrome.ts"
import { hitRate, statsLines, statsRuns } from "../../src/core/view/stats.ts"

const text = (runs: { text: string }[]) => runs.map((run) => run.text).join("")
const meterWith = (counts: Partial<Record<"hits" | "builds" | "errors" | "coalesced", number>>) => {
  const meter = createMeter(() => 0)
  for (const [name, by] of Object.entries(counts)) meter.count(name as "hits", by)
  return meter
}

describe("the numbers, said in one line", () => {
  test("leads with the frame, because that is what feels slow", () => {
    const said = text(statsRuns(createMeter(() => 0).snapshot()))
    expect(said.trim().startsWith("paint")).toBe(true)
    expect(said).toContain("p99")
  })

  test("says nothing about the cache until something has asked it", () => {
    expect(text(statsRuns(createMeter(() => 0).snapshot()))).not.toContain("cache")
    expect(text(statsRuns(meterWith({ hits: 9, builds: 1 }).snapshot()))).toContain("cache 90%")
  })

  test("mentions dropped frames and errors only when there are some", () => {
    expect(text(statsRuns(createMeter(() => 0).snapshot()))).not.toContain("error")
    const troubled = text(statsRuns(meterWith({ errors: 1, coalesced: 12 }).snapshot()))
    expect(troubled).toContain("1 error")
    expect(troubled).toContain("dropped 12")
  })

  test("a hit rate needs an ask to be a rate at all", () => {
    expect(hitRate(createMeter(() => 0).snapshot().counts)).toBeUndefined()
    expect(hitRate(meterWith({ hits: 1, builds: 1 }).snapshot().counts)).toBe(0.5)
  })

  test("the written-down version says every phase, for a log nobody is watching live", () => {
    const lines = statsLines(meterWith({ hits: 2, builds: 2 }).snapshot()).join("\n")
    for (const phase of ["paint", "build", "layout"]) expect(lines).toContain(phase)
    expect(lines).toContain("cache   50%")
  })
})

/**
 * The footer is two rows whatever it has to say, because the body's height is measured from it — a
 * footer that grew would shove the diff about every time something went wrong.
 */
describe("what the footer says instead of the keys", () => {
  const rows = (state: Parameters<typeof footerRows>[2]) => footerRows(80, { list: 20, diff: 57 }, state)

  test("keys, normally — bracketed, so a key is a shape rather than a word to parse", () => {
    expect(text(rows({ pane: "diff" })[1]?.runs ?? [])).toContain("[tab] Files")
  })

  test("trouble wins the line, and still fits in two rows", () => {
    const shown = rows({ pane: "diff", notice: "paint: bad row" })
    expect(shown).toHaveLength(2)
    expect(text(shown[1]?.runs ?? [])).toContain("paint: bad row")
    expect(text(shown[1]?.runs ?? [])).not.toContain("[tab]")
  })

  test("the numbers take it when you asked and nothing is wrong", () => {
    const shown = rows({ pane: "diff", stats: statsRuns(createMeter(() => 0).snapshot()) })
    expect(shown).toHaveLength(2)
    expect(text(shown[1]?.runs ?? [])).toContain("paint")
  })

  test("trouble outranks the numbers: a broken review is the more useful fact", () => {
    const shown = rows({
      pane: "diff",
      notice: "click: no such file",
      stats: statsRuns(createMeter(() => 0).snapshot()),
    })
    expect(text(shown[1]?.runs ?? [])).toContain("no such file")
  })
})

describe("the keys, at any width", () => {
  const keys = (width: number, state: Parameters<typeof footerRows>[2] = {}, empty = false) =>
    text(footerRows(width, { list: 20, diff: width - 23 }, state, empty)[1]?.runs ?? [])

  test("the way out is the last key to go, and a cut row says so", () => {
    for (const width of [40, 60, 100]) {
      const row = keys(width, { pane: "diff", waiting: 2 })
      expect(row).toHaveLength(width)
      expect(row).toContain("[esc] Close")
      expect(row).toContain("…")
    }
    expect(keys(200, { pane: "diff" })).not.toContain("…")
  })

  test("with nothing to review, only the keys that act", () => {
    const row = keys(100, {}, true)
    expect(row.trim()).toBe("[b] Source   [B] Base   [esc] Close")
  })

  test("the action has one name: viewed", () => {
    expect(keys(200)).toContain("[space] Viewed")
  })
})
