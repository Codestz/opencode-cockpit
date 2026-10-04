import { describe, expect, test } from "bun:test"
import { FIXTURES } from "../../src/core/fixtures.ts"
import { emptyReview } from "../../src/core/model/review.ts"
import { binaryRows } from "../../src/core/view/image.ts"
import { layout } from "../../src/core/view/layout.ts"
import { type Row, rowWidth } from "../../src/core/view/rows.ts"

const images = FIXTURES.images
const files = images?.changes.files ?? []
const looks = images?.looks ?? new Map()
const byPath = (path: string) => files.find((file) => file.path === path)
const text = (rows: readonly Row[]) => rows.map((row) => row.runs.map((run) => run.text).join(""))
const card = (path: string, width = 90) => {
  const file = byPath(path)
  if (!file) throw new Error(`no ${path} in the fixture`)
  return binaryRows(file, looks.get(path), width)
}

describe("a binary's card says what is true about it", () => {
  test("changed, same size: metadata, how much and where, the key, both pictures", () => {
    const said = text(card("media/dashboard.png"))
    expect(said[1]?.trim()).toBe("PNG 288×180 · 788 KB → 771 KB")
    expect(said[2]?.trim()).toMatch(/^\d+\.\d+% of pixels changed · \d+×\d+ at \d+,\d+$/)
    expect(said[3]?.trim()).toBe("[o] Open Both")
    expect(said.some((line) => line.includes("before") && line.includes("after · changes lit"))).toBe(true)
  })

  test("resized: says so, and no percentage", () => {
    const said = text(card("media/thumbnail.png")).join("\n")
    expect(said).toContain("PNG 288×180 → 144×90")
    expect(said).toContain("Resized")
    expect(said).not.toContain("% of pixels")
  })

  test("added and deleted: the one side there is", () => {
    expect(text(card("media/logo.png")).join("\n")).toContain("after — new")
    const deleted = text(card("media/old-banner.gif")).join("\n")
    expect(deleted).toContain("GIF 288×180 · 561 KB")
    expect(deleted).toContain("[o] Open Old Version")
    expect(deleted).toContain("before — deleted")
  })

  test("a JPEG is described, and says why there is no picture", () => {
    const said = text(card("media/photo.jpg")).join("\n")
    expect(said).toContain("JPEG 4032×3024 · 360 KB → 333 KB")
    expect(said).toContain("No preview for JPEG")
  })

  test("too large: described, with the way to see it", () => {
    const said = text(card("media/poster.png")).join("\n")
    expect(said).toContain("PNG 12000×9000 · 174 MB → 175 MB")
    expect(said).toContain("Too large to preview")
    expect(said).toContain("[o] Open Both")
  })

  test("not an image: size, and nothing it would have to guess", () => {
    expect(text(card("assets/font.woff2")).map((line) => line.trim())).toEqual([
      "",
      "binary · 12.3 KB → 14.0 KB",
      "[o] Open Both",
    ])
  })

  test("still decoding: says so where the picture will be", () => {
    const file = byPath("media/dashboard.png")
    if (!file) throw new Error("fixture")
    expect(text(binaryRows(file, { pending: true, stamp: 99 }, 90)).join("\n")).toContain("Comparing pixels…")
  })
})

describe("the pictures are rows like any other", () => {
  test("every row exactly the width, at every width", () => {
    for (const path of files.map((file) => file.path))
      for (const width of [30, 44, 60, 90, 140, 200]) {
        const file = byPath(path)
        if (!file) continue
        for (const row of binaryRows(file, looks.get(path), width)) expect(rowWidth(row)).toBe(width)
      }
  })

  test("measuring builds the same number of rows as drawing, without the cells", () => {
    for (const file of files) {
      const drawn = binaryRows(file, looks.get(file.path), 90)
      const measured = binaryRows(file, looks.get(file.path), 90, undefined, false)
      expect(measured.length).toBe(drawn.length)
      expect(measured.flatMap((row) => row.runs).some((run) => run.background !== undefined)).toBe(false)
    }
  })

  test("half blocks with an exact ink and background, identical cells merged into one run", () => {
    const rows = card("media/dashboard.png", 140)
    const picture = rows.filter((row) => row.runs.some((run) => run.text.includes("▀")))
    expect(picture.length).toBeGreaterThan(5)
    for (const row of picture)
      for (const run of row.runs.filter((each) => each.text.includes("▀"))) {
        expect(typeof run.color).toBe("number")
        expect(typeof run.background).toBe("number")
        expect(run.text).toMatch(/^▀+$/)
      }
    /** A flat UI screenshot is long runs, not a chunk per cell: the cost driver for the row pool. */
    const runs = picture.reduce((sum, row) => sum + row.runs.length, 0)
    const cells = picture.reduce((sum, row) => sum + rowWidth(row), 0)
    expect(runs).toBeLessThan(cells / 4)
  })

  test("too narrow for a picture: the words keep the room", () => {
    const narrow = card("media/dashboard.png", 18)
    expect(narrow.some((row) => row.runs.some((run) => run.background !== undefined))).toBe(false)
  })
})

describe("the review around it", () => {
  const draw = (state: Parameters<typeof layout>[2], height = 40) =>
    text(
      layout(images?.changes ?? { source: "branch", files: [] }, emptyReview(), state, {
        width: 160,
        height,
      }),
    )

  test("the footer offers [o] on a binary", () => {
    expect(draw({ pane: "diff", file: "media/dashboard.png", looks }).at(-1)).toContain("[o] Open")
    const turn = FIXTURES.turn?.changes
    if (!turn) throw new Error("fixture")
    const plain = layout(
      turn,
      emptyReview(),
      { pane: "diff", file: turn.files[0]?.path },
      { width: 160, height: 30 },
    )
    expect(text(plain).at(-1)).not.toContain("[o]")
    expect(text(plain).at(-1)).toContain("[?] Keys")
  })

  test("[?] Keys: every key in the body's place, and the way back", () => {
    const shown = draw({ keys: true }, 40)
    expect(shown.some((line) => line.includes("KEYS"))).toBe(true)
    expect(shown.some((line) => line.includes("[o]") && line.includes("system's viewer"))).toBe(true)
    expect(shown.at(-1)?.trim()).toBe("[esc] Hide Keys")
  })

  test("[?] Keys in a short pane says how many are below", () => {
    const shown = draw({ keys: true }, 14)
    expect(shown.some((line) => /↓ \d+ more keys/.test(line))).toBe(true)
  })
})
