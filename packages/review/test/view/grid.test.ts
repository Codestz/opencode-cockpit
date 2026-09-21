import { describe, expect, test } from "bun:test"
import { FIXTURES } from "../../src/core/fixtures.ts"
import { emptyReview, open, say, toggleRead } from "../../src/core/model/review.ts"
import { layout } from "../../src/core/view/layout.ts"
import { rowWidth } from "../../src/core/view/rows.ts"

/**
 * A terminal is a grid, and the design's first rule is not to fight it.
 *
 * Every row the review draws is exactly as wide as the pane — not "no wider", exactly. A row that
 * stops short leaves the background of whatever is behind it showing through, which is how a tinted
 * band ends up with a hole in it and how a file list ends up with a ragged right edge. Nothing else
 * in here enforces that, because the rows are built by five different functions that each know their
 * own width and none of them can see the result.
 *
 * So this is the check that the grid holds, across every shape the review can take.
 */

const WIDTHS = [210, 132, 105, 100, 80, 60, 44]

const scenario = (name: string) => {
  const fixture = FIXTURES[name]
  const files = fixture?.changes.files ?? []
  const first = files[0]?.path as string
  const second = (files[1] ?? files[0])?.path as string
  let review = emptyReview()
  review = open(
    review,
    { file: second, line: 2 },
    "a note long enough to wrap onto a second line in a narrow pane, and then some more words",
    "you",
    1,
  )
  review = say(review, review.threads[0]?.id as string, {
    author: "agent",
    body: "answered, at some length, so the band has two turns in it",
    at: 2,
  })
  review = open(review, { file: first }, "a whole-file note", "you", 3)
  review = toggleRead(review, first)
  return { changes: fixture?.changes, review, file: second }
}

describe("the grid holds", () => {
  for (const name of Object.keys(FIXTURES)) {
    test(`${name}: every row is exactly the width of the pane`, () => {
      const { changes, review, file } = scenario(name)
      if (!changes || changes.files.length === 0) return
      for (const width of WIDTHS) {
        for (const pane of ["files", "diff"] as const) {
          for (const thread of [undefined, review.threads[0]?.id]) {
            const rows = layout(
              changes,
              review,
              { context: 3, collapsed: new Set(), pane, file, line: 2, ...(thread ? { thread } : {}) },
              { width, height: 28 },
            )
            for (const row of rows) expect(rowWidth(row)).toBe(width - 2)
          }
        }
      }
    })
  }

  /**
   * A deep tree in a narrow pane is the case that breaks a list, so it is the case that is measured.
   *
   * The first version indented two columns a level and printed a file-type badge, which in a
   * half-width pane left about eight columns for a name — every row read `TS …`. One column a level
   * and no badge leaves the name the room, and the name is the thing you are looking for.
   */
  test("a deep tree in a narrow pane still shows names", () => {
    const { changes, review } = scenario("sprawl")
    if (!changes) return
    const rows = layout(
      changes,
      review,
      { context: 3, collapsed: new Set(), pane: "files" },
      { width: 100, height: 28 },
    )
    const names = rows
      .map((row) => row.runs.map((run) => run.text).join(""))
      .map((row) => row.slice(0, 30).trim())
      .filter((row) => row.includes(".ts"))
    expect(names.length).toBeGreaterThan(0)
    /** Something of every name survives, rather than an ellipsis where the name should be. */
    for (const name of names) expect(name.replace(/[▾▸✓…\s]/g, "").length).toBeGreaterThan(3)
  })
})
