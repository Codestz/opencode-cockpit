import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { percentText, pixelText, sizeText, summaryText } from "../../src/core/image/describe.ts"
import { decodeGif } from "../../src/core/image/gif.ts"
import { analyse, createLooks, MAX_PIXELS } from "../../src/core/image/looks.ts"
import { comparePixels, FADE, mix, shrink, toCells } from "../../src/core/image/pixels.ts"
import { decodePng } from "../../src/core/image/png.ts"
import { finish } from "../../src/core/image/steps.ts"
import type { BinaryChange, FileChange } from "../../src/core/model/review.ts"

const bytes = (name: string) => new Uint8Array(readFileSync(join(import.meta.dir, "fixtures", name)))

/** `after.png` is `before.png` with one rectangle repainted: x 40–49, y 4–9 (fixtures generator). */
const RECTANGLE = { x: 40, y: 4, width: 10, height: 6 }

describe("pixel diff", () => {
  test("finds exactly the rectangle that changed", () => {
    const diff = finish(comparePixels(decodePng(bytes("before.png")), decodePng(bytes("after.png")), 32, 20))
    expect(diff.total).toBe(64 * 40)
    expect(diff.changed).toBe(60)
    expect(diff.box).toEqual(RECTANGLE)
    expect(pixelText(diff)).toBe("2.34% of pixels changed · 10×6 at 40,4")
  })

  test("marks the change on the mask, and only there", () => {
    const diff = finish(comparePixels(decodePng(bytes("before.png")), decodePng(bytes("after.png")), 32, 20))
    const marked: number[] = []
    diff.mask?.data.forEach((on, index) => {
      if (on) marked.push(index)
    })
    /** Mask cells are 2×2 pixels: x 20–24, y 2–4. */
    expect(marked.length).toBe(15)
    for (const index of marked) {
      expect(index % 32).toBeGreaterThanOrEqual(20)
      expect(index % 32).toBeLessThanOrEqual(24)
      expect(Math.floor(index / 32)).toBeGreaterThanOrEqual(2)
      expect(Math.floor(index / 32)).toBeLessThanOrEqual(4)
    }
  })

  test("works on GIF too", () => {
    const diff = finish(comparePixels(decodeGif(bytes("before.gif")), decodeGif(bytes("after.gif")), 32, 20))
    expect(diff.box).toEqual(RECTANGLE)
  })

  test("identical pixels: nothing changed, no box", () => {
    const pixels = decodePng(bytes("before.png"))
    const diff = finish(comparePixels(pixels, pixels, 8, 8))
    expect(diff).toEqual({ changed: 0, total: 2560 })
    expect(pixelText(diff)).toBe("Same pixels — only the encoding or metadata changed")
  })

  test("refuses two sizes rather than report a percentage that lies", () => {
    expect(() =>
      finish(comparePixels(decodePng(bytes("before.png")), decodePng(bytes("resized.png")), 8, 8)),
    ).toThrow()
  })
})

describe("cells", () => {
  test("a picture fits its cells, two pixels to a cell, aspect kept", () => {
    const thumb = finish(shrink(decodePng(bytes("before.png"))))
    expect([thumb.width, thumb.height]).toEqual([64, 40])
    const cells = toCells(thumb, 32, 8, 0x1e1e2e)
    expect([cells.cols, cells.rows]).toEqual([26, 8])
    expect(cells.top.length).toBe(26 * 8)
  })

  test("transparent pixels show the pane's colour", () => {
    const thumb = finish(shrink(decodePng(bytes("rgba8.png"))))
    const clear = { width: 1, height: 2, data: new Uint8Array([255, 0, 0, 0, 0, 255, 0, 0]) }
    expect(toCells(clear, 1, 1, 0x123456).top[0]).toBe(0x123456)
    expect(thumb.width).toBe(23)
  })

  test("with a mask, what did not change fades toward the pane", () => {
    const before = decodePng(bytes("before.png"))
    const after = decodePng(bytes("after.png"))
    const thumb = finish(shrink(after))
    const diff = finish(comparePixels(before, after, thumb.width, thumb.height))
    const plain = toCells(thumb, 64, 20, 0)
    const lit = toCells(thumb, 64, 20, 0, diff.mask)
    /** Top-left is untouched: faded. Inside the rectangle: as it was. */
    expect(lit.top[0]).toBe(mix(plain.top[0] as number, 0, FADE))
    const inside = 3 * 64 + 44
    expect(lit.top[inside]).toBe(plain.top[inside] as number)
  })
})

describe("in words", () => {
  const png = (width: number, height: number, size: number) => ({
    size,
    image: { format: "png" as const, width, height },
  })
  const cases: [BinaryChange, string][] = [
    [
      { before: png(2880, 1800, 826_548), after: png(2880, 1800, 807_358) },
      "PNG 2880×1800 · 807 KB → 788 KB",
    ],
    [
      { before: png(2880, 1800, 826_548), after: png(1440, 900, 220_000) },
      "PNG 2880×1800 → 1440×900 · 807 KB → 215 KB",
    ],
    [{ after: png(96, 96, 12_904) }, "PNG 96×96 · 12.6 KB"],
    [{ before: png(96, 96, 900) }, "PNG 96×96 · 900 B"],
    [
      {
        before: png(640, 400, 91_165),
        after: { size: 40_000, image: { format: "jpeg", width: 640, height: 400 } },
      },
      "PNG 640×400 → JPEG 640×400 · 89.0 KB → 39.1 KB",
    ],
    [{ before: { size: 12_595 }, after: { size: 14_336 } }, "binary · 12.3 KB → 14.0 KB"],
    [{ after: { size: 13_849_151 } }, "binary · 13.2 MB"],
  ]
  test.each(cases)("%#: %s", (binary, said) => expect(summaryText(binary)).toBe(said))

  test("sizes", () => {
    expect([0, 1023, 1024, 102_400, 1_048_576 * 13.5].map(sizeText)).toEqual([
      "0 B",
      "1023 B",
      "1.0 KB",
      "100 KB",
      "13.5 MB",
    ])
  })

  test("percentages never round to a lie", () => {
    expect(percentText(1, 5_184_000)).toBe("<0.01%")
    expect(percentText(5_183_999, 5_184_000)).toBe(">99.99%")
    expect(percentText(10, 10)).toBe("100%")
    expect(percentText(132_710, 5_184_000)).toBe("2.56%")
    expect(percentText(1_000_000, 5_184_000)).toBe("19.3%")
  })
})

describe("looking at an image change", () => {
  const change = (before?: string, after?: string): FileChange => ({
    path: "shot.png",
    before: "",
    after: "",
    additions: 0,
    deletions: 0,
    binary: {
      ...(before
        ? { before: { size: 1, image: { format: "png", width: 64, height: 40 } }, revision: "HEAD" }
        : {}),
      ...(after ? { after: { size: 1, image: { format: "png", width: 64, height: 40 } } } : {}),
    },
  })
  const reader = (names: { before?: string; after?: string }) => {
    const reads: string[] = []
    return {
      reads,
      read: async (_file: FileChange, side: "before" | "after") => {
        reads.push(side)
        const name = names[side]
        return name ? bytes(name) : undefined
      },
    }
  }
  const now = async () => {}

  test("both sides: thumbs and the pixel diff", async () => {
    const { read } = reader({ before: "before.png", after: "after.png" })
    const look = await analyse(change("b", "a"), read, now)
    expect(look.diff?.box).toEqual(RECTANGLE)
    expect(look.before?.width).toBe(64)
    expect(look.after?.width).toBe(64)
    expect(look.problem).toBeUndefined()
  })

  test("decoded once: the same bytes again come from the cache", async () => {
    const { read } = reader({ before: "before.png", after: "after.png" })
    const first = await analyse(change("b", "a"), read, now)
    const again = await analyse(change("b", "a"), read, now)
    expect(again.after).toBe(first.after as NonNullable<typeof first.after>)
    expect(again.diff).toBe(first.diff as NonNullable<typeof first.diff>)
  })

  test("one side: a thumb and no diff", async () => {
    const { read } = reader({ after: "after.png" })
    const look = await analyse(change(undefined, "a"), read, now)
    expect(look.after).toBeDefined()
    expect(look.before).toBeUndefined()
    expect(look.diff).toBeUndefined()
  })

  test("too large to decode: said, and nothing read", async () => {
    const { read, reads } = reader({ before: "before.png", after: "after.png" })
    const huge = change("b", "a")
    const side = { size: 1, image: { format: "png" as const, width: 5000, height: 5000 } }
    huge.binary = { before: side, after: side, revision: "HEAD" }
    expect(5000 * 5000).toBeGreaterThan(MAX_PIXELS)
    const look = await analyse(huge, read, now)
    expect(look.problem).toContain("Too large to preview")
    expect(reads).toEqual([])
  })

  test("a damaged file: said, not thrown", async () => {
    const look = await analyse(change(undefined, "a"), async () => bytes("before.png").subarray(0, 50), now)
    expect(look.problem).toContain("could not")
    expect(look.after).toBeUndefined()
  })

  test("the pane's looks: pending at once, done later, a paint asked for each time", async () => {
    let paints = 0
    const { read } = reader({ before: "before.png", after: "after.png" })
    const looks = createLooks(read, () => paints++, now)
    looks.sync([change("b", "a"), { path: "x.ts", before: "a", after: "b", additions: 1, deletions: 1 }])
    expect(looks.current().get("shot.png")?.pending).toBe(true)
    expect(looks.current().has("x.ts")).toBe(false)
    for (let turn = 0; turn < 50 && looks.current().get("shot.png")?.pending; turn++) await Bun.sleep(1)
    expect(looks.current().get("shot.png")?.diff?.changed).toBe(60)
    expect(paints).toBeGreaterThanOrEqual(2)
  })

  test("a later sync wins over one still working", async () => {
    const { read } = reader({ before: "before.png", after: "after.png" })
    const looks = createLooks(read, () => {}, now)
    looks.sync([change("b", "a")])
    looks.sync([])
    await Bun.sleep(20)
    expect(looks.current().size).toBe(0)
  })
})
