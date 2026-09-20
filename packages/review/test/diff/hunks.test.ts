import { describe, expect, test } from "bun:test"
import { countChanges, diffLines, type Line, toHunks, toLines } from "../../src/core/diff/hunks.ts"

/**
 * A diff engine is worth testing against the files that break diff engines, not against the happy
 * case. Every test here is one of those: an empty file, a file with no trailing newline, a pure
 * insertion at the top, a change at the very last line, a file that only moved.
 *
 * The line numbers matter more than the classification. A comment lands on "line 39", and a review
 * that says 39 when the file says 40 is worse than no review at all.
 */

/** Compact rendering, so an expectation reads like the diff it describes. */
const show = (lines: readonly Line[]) =>
  lines.map((line) => `${line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " "}${line.text}`)

const numbered = (lines: readonly Line[]) =>
  lines.map((line) => `${line.before ?? ""}|${line.after ?? ""}|${line.text}`)

describe("splitting a file into lines", () => {
  test("a trailing newline ends the last line rather than starting an empty one", () => {
    expect(toLines("a\nb\n")).toEqual(["a", "b"])
  })

  test("a file with no trailing newline has the same lines", () => {
    expect(toLines("a\nb")).toEqual(["a", "b"])
  })

  test("an empty file has no lines at all", () => {
    // Not [""] — that would read as a one-line file and make every creation show a change.
    expect(toLines("")).toEqual([])
  })

  test("a file that is only a newline has one empty line", () => {
    expect(toLines("\n")).toEqual([""])
  })
})

describe("a line changed in the middle", () => {
  const before = "one\ntwo\nthree\n"
  const after = "one\nTWO\nthree\n"

  test("is a removal and an addition, in that order, keeping the rest as context", () => {
    expect(show(diffLines(before, after))).toEqual([" one", "-two", "+TWO", " three"])
  })

  test("numbers both sides from their own file", () => {
    expect(numbered(diffLines(before, after))).toEqual(["1|1|one", "2||two", "|2|TWO", "3|3|three"])
  })

  test("counts one addition and one deletion", () => {
    expect(countChanges(diffLines(before, after))).toEqual({ additions: 1, deletions: 1 })
  })
})

describe("insertions and deletions", () => {
  test("a line added at the top shifts every line number after it", () => {
    const lines = diffLines("a\nb\n", "new\na\nb\n")
    expect(show(lines)).toEqual(["+new", " a", " b"])
    expect(lines[1]).toMatchObject({ before: 1, after: 2 })
  })

  test("a line added at the very end is still numbered", () => {
    const lines = diffLines("a\n", "a\nb\n")
    expect(lines.at(-1)).toMatchObject({ kind: "add", after: 2, text: "b" })
  })

  test("a deleted line keeps its old number and has no new one", () => {
    const lines = diffLines("a\nb\nc\n", "a\nc\n")
    expect(lines[1]).toEqual({ kind: "remove", before: 2, text: "b" })
  })

  test("nothing changed is all context", () => {
    expect(diffLines("a\nb\n", "a\nb\n").every((line) => line.kind === "context")).toBe(true)
  })
})

describe("a file that did not exist, or no longer does", () => {
  test("a new file is every line added, numbered from one", () => {
    const lines = diffLines("", "a\nb\n")
    expect(show(lines)).toEqual(["+a", "+b"])
    expect(lines[1]?.after).toBe(2)
    expect(lines[0]?.before).toBeUndefined()
  })

  test("a deleted file is every line removed", () => {
    expect(show(diffLines("a\nb\n", ""))).toEqual(["-a", "-b"])
  })

  test("two empty files are not a change", () => {
    expect(diffLines("", "")).toEqual([])
  })
})

describe("repeated lines", () => {
  /** The classic wrong answer: matching the second `}` to the first and inventing a change. */
  test("a block inserted between identical lines does not drag the closing line with it", () => {
    const lines = diffLines("if (a) {\n}\n", "if (a) {\n  work()\n}\n")
    expect(show(lines)).toEqual([" if (a) {", "+  work()", " }"])
  })

  test("repeated identical lines are aligned rather than rewritten", () => {
    const lines = diffLines("x\nx\nx\n", "x\nx\nx\nx\n")
    expect(countChanges(lines)).toEqual({ additions: 1, deletions: 0 })
  })
})

describe("hunks", () => {
  const file = (count: number) => `${Array.from({ length: count }, (_, i) => `line ${i + 1}`).join("\n")}\n`

  test("an unchanged file has no hunks at all", () => {
    expect(toHunks(file(10), file(10))).toEqual([])
  })

  test("untouched stretches are left out, and each hunk says where it starts", () => {
    const before = file(40)
    const after = before.replace("line 5\n", "LINE 5\n").replace("line 35\n", "LINE 35\n")
    const hunks = toHunks(before, after, { context: 2 })
    expect(hunks).toHaveLength(2)
    expect(hunks[0]?.beforeStart).toBe(3)
    expect(hunks[1]?.beforeStart).toBe(33)
    // 2 context + remove + add + 2 context
    expect(hunks[0]?.lines).toHaveLength(6)
  })

  test("changes closer together than twice the context become one hunk", () => {
    const before = file(20)
    const after = before.replace("line 5\n", "LINE 5\n").replace("line 8\n", "LINE 8\n")
    expect(toHunks(before, after, { context: 3 })).toHaveLength(1)
  })

  test("context of zero keeps only the changed lines", () => {
    const before = file(10)
    const after = before.replace("line 5\n", "LINE 5\n")
    const hunks = toHunks(before, after, { context: 0 })
    expect(show(hunks[0]?.lines ?? [])).toEqual(["-line 5", "+LINE 5"])
    expect(hunks[0]?.beforeStart).toBe(5)
  })

  test("a change on the first line starts the hunk at one, not at zero", () => {
    const hunks = toHunks("a\nb\nc\n", "A\nb\nc\n", { context: 3 })
    expect(hunks[0]).toMatchObject({ beforeStart: 1, afterStart: 1 })
  })

  test("a new file is one hunk starting at line one", () => {
    const hunks = toHunks("", "a\nb\n")
    expect(hunks).toHaveLength(1)
    expect(hunks[0]).toMatchObject({ afterStart: 1 })
    expect(hunks[0]?.lines).toHaveLength(2)
  })

  test("a hunk that opens on an added line still reports where the old file was", () => {
    // Nothing was removed at the top, so `beforeStart` has to come from the context that follows.
    const hunks = toHunks("a\nb\n", "new\na\nb\n", { context: 1 })
    expect(hunks[0]).toMatchObject({ beforeStart: 1, afterStart: 1 })
  })
})

describe("files too large to align", () => {
  /**
   * Past the limit the table would cost more memory than anyone reading gets back. Falling back to
   * "all out, all in" is honest and bounded; pretending to diff it is neither.
   */
  test("a file past the limit is reported as a whole replacement rather than refused", () => {
    const big = (token: string) => `${Array.from({ length: 5100 }, (_, i) => `${token} ${i}`).join("\n")}\n`
    const lines = diffLines(big("a"), big("b"))
    expect(lines).toHaveLength(10_200)
    expect(lines.every((line) => line.kind !== "context")).toBe(true)
  })
})

describe("whitespace and endings", () => {
  test("a line that only gained trailing whitespace is a change, because it is one", () => {
    expect(countChanges(diffLines("a\n", "a \n"))).toEqual({ additions: 1, deletions: 1 })
  })

  test("adding a trailing newline to a file that lacked one is not a phantom change", () => {
    expect(countChanges(diffLines("a\nb", "a\nb\n"))).toEqual({ additions: 0, deletions: 0 })
  })

  test("carriage returns are content, not line breaks", () => {
    // A CRLF file diffed against an LF one really has changed every line; saying otherwise would
    // hide a real problem in someone's editor.
    expect(countChanges(diffLines("a\r\nb\r\n", "a\nb\n"))).toEqual({ additions: 2, deletions: 2 })
  })
})

describe("large files", () => {
  /**
   * The case the view exists for and the one a naive alignment cannot serve: a long file with a small
   * edit in it. Without trimming the identical head and tail this builds a 3000×3000 table — tens of
   * megabytes inside the TUI's worker thread — and takes long enough to be felt.
   */
  test("a three-thousand-line file with one edit diffs quickly, with honest line numbers", () => {
    const lines = Array.from({ length: 3000 }, (_, index) => `line ${index + 1}`)
    const before = lines.join("\n")
    const edited = [...lines]
    edited[1499] = "line 1500 — changed"
    const after = edited.join("\n")

    const started = performance.now()
    const hunks = toHunks(before, after)
    const elapsed = performance.now() - started

    expect(elapsed).toBeLessThan(250)
    expect(hunks).toHaveLength(1)

    const removed = hunks[0]?.lines.find((line) => line.kind === "remove")
    const added = hunks[0]?.lines.find((line) => line.kind === "add")
    expect(removed?.before).toBe(1500)
    expect(added?.after).toBe(1500)
    expect(added?.text).toBe("line 1500 — changed")
  })

  test("a rewrite is reported as everything out then everything in, still numbered from the file", () => {
    const before = Array.from({ length: 2500 }, (_, index) => `old ${index}`).join("\n")
    const after = Array.from({ length: 2500 }, (_, index) => `new ${index}`).join("\n")
    const lines = diffLines(before, after)

    expect(lines.filter((line) => line.kind === "context")).toHaveLength(0)
    expect(lines.find((line) => line.kind === "remove")?.before).toBe(1)
    expect(lines.find((line) => line.kind === "add")?.after).toBe(1)
    expect(lines.at(-1)?.after).toBe(2500)
  })
})
