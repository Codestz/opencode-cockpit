import { describe, expect, test } from "bun:test"
import { emptyReview, filesElsewhere, open } from "../../src/core/model/review.ts"
import { layout } from "../../src/core/view/layout.ts"
import { navigableRows } from "../../src/core/view/list.ts"

/**
 * Commit the work you were reviewing and the worktree diff empties. The comments are still true and
 * still on disk; what they lost is a file in front of you to be drawn against. Dropping them from
 * the screen is how a review quietly loses half of itself.
 */

const changes = {
  source: "worktree" as const,
  files: [{ path: "src/still-here.ts", before: "a\n", after: "a\nb\n", additions: 1, deletions: 0 }],
}

const withNote = () => {
  let review = open(emptyReview(), { file: "src/still-here.ts", line: 2 }, "this one has a diff", "you", 1)
  review = open(review, { file: "src/committed-away.ts", line: 9 }, "and this one does not", "you", 2)
  return review
}

describe("comments whose file is not in this diff", () => {
  test("are found, and named", () => {
    expect(filesElsewhere(withNote(), changes)).toEqual(["src/committed-away.ts"])
    expect(filesElsewhere(emptyReview(), changes)).toEqual([])
  })

  test("reach the cursor, at the foot of the list", () => {
    const rows = navigableRows(changes, { elsewhere: ["src/committed-away.ts"] })
    expect(rows.at(-1)?.path).toBe("src/committed-away.ts")
    /** Flat, not folded into the tree of a change it is not part of. */
    expect(rows.at(-1)?.depth).toBe(0)
  })

  test("and show their threads when opened, with no diff to hang them on", () => {
    const rows = layout(
      changes,
      withNote(),
      {
        context: 3,
        collapsed: new Set(),
        file: "src/committed-away.ts",
        elsewhere: ["src/committed-away.ts"],
      },
      { width: 120, height: 24 },
    )
    const said = rows.map((row) => row.runs.map((run) => run.text).join("")).join(" ")
    expect(said).toContain("committed-away.ts")
    expect(said).toContain("and this one does not")
    expect(said).toContain("Not in this diff")
    /** The other file's comment is not dragged in with it. */
    expect(said).not.toContain("this one has a diff")
  })

  test("the pane still measures exactly one width", () => {
    for (const width of [132, 100, 80]) {
      const rows = layout(
        changes,
        withNote(),
        {
          context: 3,
          collapsed: new Set(),
          file: "src/committed-away.ts",
          elsewhere: ["src/committed-away.ts"],
        },
        { width, height: 24 },
      )
      for (const row of rows) {
        expect(row.runs.reduce((sum, run) => sum + run.text.length, 0)).toBe(width - 2)
      }
    }
  })
})
