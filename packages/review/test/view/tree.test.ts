import { describe, expect, test } from "bun:test"
import { clipRuns } from "../../src/core/view/rows.ts"
import { treeRows } from "../../src/core/view/tree.ts"

const text = (runs: { text: string }[]) => runs.map((run) => run.text).join("")

describe("treeRows", () => {
  test("groups files under the folders that hold them, showing basenames", () => {
    const rows = treeRows([
      "packages/review/src/core/diff/hunks.ts",
      "packages/review/src/core/diff/words.ts",
      "packages/review/src/tui/index.tsx",
      "packages/review/src/tui/keys.ts",
    ])
    const names = rows.map((row) => `${"  ".repeat(row.depth)}${row.name}`)
    expect(names).toEqual([
      "packages/review/src",
      "  core/diff",
      "    hunks.ts",
      "    words.ts",
      "  tui",
      "    index.tsx",
      "    keys.ts",
    ])
  })

  test("joins a chain of folders that hold nothing else, the way a pull request does", () => {
    const rows = treeRows([".github/workflows/release.yml", ".github/workflows/check.yml"])
    expect(rows[0]).toMatchObject({ kind: "folder", name: ".github/workflows", depth: 0 })
    expect(rows[1]).toMatchObject({ kind: "file", name: "release.yml", depth: 1 })
  })

  /** `sprawl`: forty modules with an `index.ts` each was eighty rows, and thirteen files on a screen. */
  test("a folder holding one file and nothing else is joined into the file's row", () => {
    const rows = treeRows(["src/a/index.ts", "src/b/index.ts", "src/c/d/deep.ts", "src/c/d/other.ts"])
    expect(rows.map((row) => `${row.kind}:${"  ".repeat(row.depth)}${row.name}`)).toEqual([
      "folder:src",
      "file:  a/index.ts",
      "file:  b/index.ts",
      "folder:  c/d",
      "file:    deep.ts",
      "file:    other.ts",
    ])
    /** Still the file's own path: everything else in the review identifies a file by it. */
    expect(rows[1]).toMatchObject({ path: "src/a/index.ts" })
  })

  test("a lone file deep in a chain is one row", () => {
    expect(treeRows([".github/workflows/release.yml"])).toEqual([
      {
        kind: "file",
        path: ".github/workflows/release.yml",
        name: ".github/workflows/release.yml",
        depth: 0,
      },
    ])
  })

  test("a folder knows how many files are beneath it, however deep", () => {
    const rows = treeRows(["a/b/one.ts", "a/c/two.ts", "a/c/d/three.ts"])
    expect(rows.find((row) => row.kind === "folder" && row.name === "a")).toMatchObject({ files: 3 })
  })

  test("a collapsed folder hides its contents but keeps its own row", () => {
    const rows = treeRows(["src/core/one.ts", "src/core/two.ts", "src/tui/three.tsx"], new Set(["src/core"]))
    expect(rows.map((row) => row.name)).toEqual(["src", "core", "tui/three.tsx"])
  })

  test("files at the root keep their place", () => {
    const rows = treeRows(["README.md", "src/one.ts", "src/two.ts"])
    expect(rows.map((row) => row.name)).toEqual(["src", "one.ts", "two.ts", "README.md"])
  })

  test("no paths, no rows", () => {
    expect(treeRows([])).toEqual([])
  })
})

describe("clipRuns", () => {
  test("keeps colours when a line is too wide for its column", () => {
    const runs = [
      { text: "const", tone: "keyword" as const },
      { text: " open = ", tone: "text" as const },
      { text: "false", tone: "number" as const },
    ]
    const clipped = clipRuns(runs, 10, "none")
    expect(clipped.map((run) => run.tone)).toEqual(["keyword", "text"])
    expect(clipped.map((run) => run.text).join("")).toBe("const ope…")
  })

  test("pads a short line to exactly the column width, so the tint reaches the edge", () => {
    const clipped = clipRuns([{ text: "ab", tone: "text" as const }], 6, "added")
    expect(clipped.map((run) => run.text).join("")).toBe("ab    ")
    expect(clipped.at(-1)?.fill).toBe("added")
  })

  test("a line that fits exactly is left alone", () => {
    const runs = [{ text: "abcdef", tone: "text" as const }]
    expect(clipRuns(runs, 6, "none")).toEqual(runs)
  })

  /** The bug: a cut on the gap between two keys saw only spaces and dropped the rest without a word. */
  test("a cut that lands on a gap still says there was more", () => {
    const runs = [{ text: "[b] Base" }, { text: "   " }, { text: "[q] Close" }]
    expect(text(clipRuns(runs, 10, "none"))).toBe("[b] Base …")
    expect(text(clipRuns(runs, 8, "none"))).toBe("[b] Bas…")
  })

  test("padding cut off the end is not worth an ellipsis", () => {
    expect(text(clipRuns([{ text: "ab" }, { text: "    " }], 4, "none"))).toBe("ab  ")
  })

  test("no room means no runs", () => {
    expect(clipRuns([{ text: "x" }], 0, "none")).toEqual([])
  })
})
