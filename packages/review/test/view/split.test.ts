import { describe, expect, test } from "bun:test"
import { FIXTURES } from "../../src/core/fixtures.ts"
import { emptyReview } from "../../src/core/model/review.ts"
import { MAX_LIST_COLUMNS, MIN_LIST_COLUMNS, splitColumns } from "../../src/core/view/geometry.ts"
import { columnsFor, layout } from "../../src/core/view/layout.ts"
import { listWidth } from "../../src/core/view/list.ts"

/**
 * The file list's width: sized from its names, never so narrow that `index.tsx` reads `…ex.tsx`, and
 * never so greedy that the half-width pane loses its second column.
 */

const changes = (paths: string[]) => ({
  source: "branch" as const,
  files: paths.map((path) => ({ path, before: "a\n", after: "b\n", additions: 1, deletions: 1 })),
})

const screen = (name: string, width: number, height: number) => {
  const fixture = FIXTURES[name]
  if (!fixture) throw new Error(name)
  return layout(fixture.changes, emptyReview(), { context: 3, pane: "files" }, { width, height }).map((row) =>
    row.runs.map((run) => run.text).join(""),
  )
}

describe("the list's width", () => {
  test("is never narrower than the minimum while it shows", () => {
    for (let width = 60; width <= 240; width++) {
      const { list } = splitColumns(width, 0)
      if (list > 0) expect(list).toBeGreaterThanOrEqual(MIN_LIST_COLUMNS)
    }
  })

  /** Raising the list's minimum must not cost the half-width pane its list. */
  test("two columns start where they always did", () => {
    expect(splitColumns(94).list).toBe(0)
    expect(splitColumns(95).list).toBeGreaterThan(0)
  })

  test("follows the names, between its limits", () => {
    const short = changes(["a.ts", "b.ts"])
    const long = changes(["packages/app/src/feature/a-name-long-enough-to-want-more.ts", "x.ts"])
    expect(columnsFor({ width: 200, height: 30 }, short).list).toBe(MIN_LIST_COLUMNS)
    expect(columnsFor({ width: 200, height: 30 }, long).list).toBe(MAX_LIST_COLUMNS)
    const sprawl = FIXTURES.sprawl?.changes
    if (!sprawl) throw new Error("sprawl")
    const wanted = listWidth(sprawl)
    expect(wanted).toBeGreaterThan(MIN_LIST_COLUMNS)
    expect(columnsFor({ width: 200, height: 30 }, sprawl).list).toBe(wanted)
  })

  test("at half width, a name is still a name", () => {
    const rows = screen("turn", 100, 12)
    expect(rows.some((row) => row.includes(" tui/index.tsx "))).toBe(true)
    expect(rows.some((row) => row.includes(" core/config.ts "))).toBe(true)
  })
})

describe("folders of one file", () => {
  /** Forty modules of one `index.ts` each: thirteen of them fitted on a thirty-row screen. */
  test("cost no row of their own", () => {
    const rows = screen("sprawl", 180, 30)
    const listed = rows.filter((row) => /module-\d\d\/index\.ts/.test(row.slice(0, 40)))
    expect(listed.length).toBe(25)
  })
})
