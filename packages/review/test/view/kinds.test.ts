import { describe, expect, test } from "bun:test"
import { FIXTURES } from "../../src/core/fixtures.ts"
import { emptyReview } from "../../src/core/model/review.ts"
import { changeOf } from "../../src/core/view/counts.ts"
import { fileRows } from "../../src/core/view/list.ts"
import { rowWidth } from "../../src/core/view/rows.ts"
import { headerRow, streamOf } from "../../src/core/view/stream.ts"

/**
 * New, deleted and renamed files say so. A deleted file was a card of red lines that read exactly
 * like "rewrote everything", and `src/old/legacy.ts −10` in the list said nothing more.
 */

const created = FIXTURES.created?.changes
if (!created) throw new Error("the created fixture")
const text = (runs: { text: string }[]) => runs.map((run) => run.text).join("")

const heading = (path: string, inner: number) => {
  const segment = streamOf(created, emptyReview(), {}, inner + 2).segments.find((each) => each.path === path)
  if (!segment) throw new Error(path)
  return headerRow(segment, emptyReview(), inner)
}

describe("a file's heading", () => {
  test("says new, deleted, or where a file was renamed from", () => {
    expect(text(heading("src/core/notices.ts", 140).runs)).toContain("src/core/notices.ts new")
    expect(text(heading("src/old/legacy.ts", 140).runs)).toContain("src/old/legacy.ts deleted")
    expect(text(heading("src/core/settings.ts", 140).runs)).toContain(
      "src/core/settings.ts renamed from src/config/load.ts",
    )
  })

  test("the word is muted: it is read once, not looked for", () => {
    const word = heading("src/old/legacy.ts", 140).runs.find((run) => run.text.trim() === "deleted")
    expect(word?.tone).toBe("muted")
  })

  test("in a narrow card the old path goes first, then the folders, and never the name", () => {
    expect(text(heading("src/core/settings.ts", 60).runs)).toMatch(/settings\.ts renamed /)
    const tight = text(heading("src/old/legacy.ts", 40).runs)
    expect(tight).toContain("legacy.ts")
    for (const inner of [24, 30, 40, 52, 60, 80, 140])
      for (const path of ["src/core/notices.ts", "src/old/legacy.ts", "src/core/settings.ts"])
        expect(rowWidth(heading(path, inner))).toBe(inner)
  })
})

describe("the file list", () => {
  test("says it after the name when there is room for both", () => {
    const rows = fileRows(created, emptyReview(), {}, 40).map((row) => text(row.runs))
    expect(rows.some((row) => row.includes("notices.ts new"))).toBe(true)
    expect(rows.some((row) => row.includes("legacy.ts deleted"))).toBe(true)
    expect(rows.some((row) => row.includes("settings.ts renamed"))).toBe(true)
  })

  test("and gives the word up before any of the name", () => {
    for (const width of [20, 26, 30, 40]) {
      for (const row of fileRows(created, emptyReview(), {}, width)) expect(rowWidth(row)).toBe(width)
    }
    const narrow = fileRows(created, emptyReview(), {}, 26).map((row) => text(row.runs))
    expect(narrow.some((row) => row.includes("settings.ts"))).toBe(true)
  })
})

describe("what a file's change is", () => {
  test("git's word wins; without one, an empty side says it", () => {
    const base = { path: "a.ts", additions: 0, deletions: 0 }
    expect(changeOf({ ...base, before: "", after: "x\n" })).toBe("added")
    expect(changeOf({ ...base, before: "x\n", after: "" })).toBe("deleted")
    expect(changeOf({ ...base, before: "x\n", after: "y\n" })).toBeUndefined()
    expect(changeOf({ ...base, before: "x\n", after: "y\n", change: "renamed", from: "b.ts" })).toBe(
      "renamed",
    )
  })
})
