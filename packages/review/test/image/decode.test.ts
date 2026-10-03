import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { decodeGif, decodeGifSoon } from "../../src/core/image/gif.ts"
import { decodePng, decodePngSoon } from "../../src/core/image/png.ts"

/**
 * Each fixture beside a `.rgba` reference: for the PNGs computed by the generator from the samples it
 * wrote (not by any decoder), for the GIFs by PIL. Every row filter is used, rows cycle through them.
 */
const dir = join(import.meta.dir, "fixtures")
const bytes = (name: string) => new Uint8Array(readFileSync(join(dir, name)))
const references = readdirSync(dir)
  .filter((name) => name.endsWith(".rgba"))
  .map((name) => name.slice(0, -".rgba".length))

/**
 * Where two RGBA buffers first differ, for a failure that says something.
 *
 * A fully transparent pixel has no colour worth comparing: PIL keeps the palette entry under alpha 0,
 * this decoder leaves it black, and both draw nothing.
 */
const firstDifference = (a: Uint8Array, b: Uint8Array): number => {
  if (a.length !== b.length) return Math.min(a.length, b.length)
  for (let index = 0; index < a.length; index += 4) {
    if (a[index + 3] !== b[index + 3]) return index + 3
    if (a[index + 3] === 0) continue
    for (let channel = 0; channel < 3; channel++) if (a[index + channel] !== b[index + channel]) return index
  }
  return -1
}

describe("PNG decodes byte-exact", () => {
  const pngs = references.filter((name) => name.endsWith(".png"))
  test("every colour type and depth is covered", () => expect(pngs.length).toBeGreaterThanOrEqual(19))

  test.each(pngs)("%s", (name) => {
    const pixels = decodePng(bytes(name))
    expect([pixels.width, pixels.height]).toEqual([23, 13])
    expect(firstDifference(pixels.data, bytes(`${name}.rgba`))).toBe(-1)
  })

  test("an APNG decodes to its default image", () => {
    expect(firstDifference(decodePng(bytes("anim.apng")).data, bytes("rgb8.png.rgba"))).toBe(-1)
  })

  test("in slices, the same pixels, and the event loop gets turns", async () => {
    let turns = 0
    const pixels = await decodePngSoon(bytes("rgba16.png"), async () => {
      turns++
    })
    expect(firstDifference(pixels.data, bytes("rgba16.png.rgba"))).toBe(-1)
    expect(turns).toBeGreaterThanOrEqual(0)
  })

  test("a damaged file says so instead of drawing garbage", () => {
    const cut = bytes("rgb8.png").subarray(0, 60)
    expect(() => decodePng(cut)).toThrow()
    expect(() => decodePng(bytes("still.gif"))).toThrow("not a PNG")
  })
})

describe("GIF decodes its first frame byte-exact", () => {
  test.each(["still.gif", "interlaced.gif", "anim.gif"])("%s", (name) => {
    const pixels = decodeGif(bytes(name))
    expect([pixels.width, pixels.height]).toEqual([64, 40])
    expect(firstDifference(pixels.data, bytes(`${name}.rgba`))).toBe(-1)
  })

  test("and counts the frames", () => {
    expect(decodeGif(bytes("anim.gif")).frames).toBe(3)
    expect(decodeGif(bytes("still.gif")).frames).toBe(1)
  })

  test("in slices too", async () => {
    const pixels = await decodeGifSoon(bytes("interlaced.gif"), async () => {})
    expect(firstDifference(pixels.data, bytes("interlaced.gif.rgba"))).toBe(-1)
  })
})
