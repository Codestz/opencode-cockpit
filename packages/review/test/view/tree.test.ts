import { describe, expect, test } from "bun:test"
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
