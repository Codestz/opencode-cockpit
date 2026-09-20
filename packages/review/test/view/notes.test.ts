import { describe, expect, test } from "bun:test"
import { addNote, emptyReview } from "../../src/core/model/review.ts"
import { diffRows } from "../../src/core/view/layout.ts"

const file = {
  path: "a.ts",
  before: "one\ntwo\nthree\nfour\n",
  after: "one\nTWO\nthree\nfour\n",
  additions: 1,
  deletions: 1,
}

describe("where a note lands", () => {
  test("a note on a line is drawn immediately under that line", () => {
    const review = addNote(emptyReview(), { file: "a.ts", line: 2, body: "here" })
    const rows = diffRows(file, review, { context: 3 }, 80)
    const text = rows.map((row) => row.runs.map((run) => run.text).join(""))
    const noteAt = text.findIndex((row) => row.includes("note ·"))
    const lineAt = text.findIndex((row) => row.includes("TWO"))
    expect(noteAt).toBe(lineAt + 1)
  })

  test("a note about a range is drawn under the last line it covers", () => {
    const review = addNote(emptyReview(), { file: "a.ts", line: 1, through: 3, body: "all three" })
    const rows = diffRows(file, review, { context: 3 }, 80)
    const text = rows.map((row) => row.runs.map((run) => run.text).join(""))
    const noteAt = text.findIndex((row) => row.includes("note ·"))
    const lastAt = text.findIndex((row) => row.includes("three"))
    expect(noteAt).toBe(lastAt + 1)
    expect(text[noteAt]).toContain("lines 1–3")
  })

  test("the note's title names the line it was written against", () => {
    const review = addNote(emptyReview(), { file: "a.ts", line: 2, body: "here" })
    const rows = diffRows(file, review, { context: 3 }, 80)
    const title = rows
      .map((row) => row.runs.map((run) => run.text).join(""))
      .find((row) => row.includes("note ·"))
    expect(title).toContain("line 2")
  })
})
