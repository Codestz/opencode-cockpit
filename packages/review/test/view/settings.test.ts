import { describe, expect, test } from "bun:test"
import { emptyReview } from "../../src/core/model/review.ts"
import { settingsRow } from "../../src/core/view/chrome.ts"
import { HEADER_ROWS } from "../../src/core/view/geometry.ts"
import { layout } from "../../src/core/view/layout.ts"
import type { Row } from "../../src/core/view/rows.ts"

/**
 * Review has no sidebar block, so a setting it does not read was a toast gone in ten seconds. It is
 * now the shared `!` row in the pane, in place of the header's rule — and the header stays two rows,
 * so a click still lands on the row drawn under it.
 */

const changes = {
  source: "worktree" as const,
  files: [{ path: "src/a.ts", before: "a\n", after: "a\nb\n", additions: 1, deletions: 0 }],
}
const OLD = 'settings: "review.sidebarOrder" is no longer read — run /cockpit-setup'
const text = (row: Row | undefined) => row?.runs.map((run) => run.text).join("") ?? ""
const draw = (settings?: string[]) =>
  layout(
    changes,
    emptyReview(),
    { context: 3, ...(settings ? { settings } : {}) },
    { width: 120, height: 20 },
  )

describe("settings notices in the pane", () => {
  test("one notice: `!` in the warning tone, then its sentence, under the header", () => {
    const row = draw([OLD])[HEADER_ROWS - 1]
    expect(text(row).trim()).toBe(`! ${OLD}`)
    expect(row?.runs.find((run) => run.text.includes("!"))?.tone).toBe("warning")
  })

  test("none: the rule is back, and the pane is the same height either way", () => {
    expect(text(draw()[HEADER_ROWS - 1])).toMatch(/^─+$/)
    expect(draw([OLD])).toHaveLength(draw().length)
  })

  test("several: how many comes first, so a narrow pane still says there is more", () => {
    const row = settingsRow([OLD, 'settings: "review.source" should be a string'], 50)
    expect(text(row)).toStartWith("! settings: 2 to fix, run /cockpit-setup")
    expect(text(row)).toHaveLength(50)
  })
})
