import { describe, expect, test } from "bun:test"
import { clipRuns } from "../../src/core/view/rows.ts"
import { treeRows } from "../../src/core/view/tree.ts"

describe("treeRows", () => {
  test("groups files under the folders that hold them, showing basenames", () => {
    const rows = treeRows(["packages/review/src/core/diff/hunks.ts", "packages/review/src/tui/index.tsx"])
    const names = rows.map((row) => `${"  ".repeat(row.depth)}${row.name}`)
    expect(names).toEqual(["packages/review/src", "  core/diff", "    hunks.ts", "  tui", "    index.tsx"])
  })

  test("joins a chain of folders that hold nothing else, the way a pull request does", () => {
    const rows = treeRows([".github/workflows/release.yml"])
    expect(rows[0]).toMatchObject({ kind: "folder", name: ".github/workflows", depth: 0 })
    expect(rows[1]).toMatchObject({ kind: "file", name: "release.yml", depth: 1 })
  })

  test("a folder knows how many files are beneath it, however deep", () => {
    const rows = treeRows(["a/b/one.ts", "a/c/two.ts", "a/c/d/three.ts"])
    expect(rows.find((row) => row.kind === "folder" && row.name === "a")).toMatchObject({ files: 3 })
  })

  test("a collapsed folder hides its contents but keeps its own row", () => {
    const rows = treeRows(["src/core/one.ts", "src/tui/two.tsx"], new Set(["src/core"]))
    expect(rows.map((row) => row.name)).toEqual(["src", "core", "tui", "two.tsx"])
  })

  test("files at the root keep their place", () => {
    const rows = treeRows(["README.md", "src/one.ts"])
    expect(rows.map((row) => row.name)).toEqual(["src", "one.ts", "README.md"])
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

  test("no room means no runs", () => {
    expect(clipRuns([{ text: "x" }], 0, "none")).toEqual([])
  })
})
