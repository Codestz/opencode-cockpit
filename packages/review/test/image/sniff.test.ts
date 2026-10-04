import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  decodable,
  formatName,
  looksBinary,
  readBmp,
  readGif,
  readJpeg,
  readPng,
  readWebp,
  sniff,
} from "../../src/core/image/sniff.ts"

/**
 * Fixtures are small files written by PIL and by hand (every PNG colour type and depth from a raw
 * writer, so the reference RGBA is computed independently of any decoder); sizes checked with `sips`.
 */
const fixture = (name: string) => new Uint8Array(readFileSync(join(import.meta.dir, "fixtures", name)))

describe("binary, by git's rule", () => {
  test("a NUL in the first 8000 bytes is binary", () => {
    expect(looksBinary(fixture("blob.bin"))).toBe(true)
    expect(looksBinary(fixture("rgb8.png"))).toBe(true)
  })

  test("text, however odd, is not", () => {
    expect(looksBinary(new TextEncoder().encode("héllo — ✓ \t\r\n\u001b[31m"))).toBe(false)
    expect(looksBinary(new Uint8Array(0))).toBe(false)
  })

  test("a NUL past 8000 bytes does not count, as in git", () => {
    const late = new Uint8Array(9000).fill(97)
    late[8500] = 0
    expect(looksBinary(late)).toBe(false)
    late[7999] = 0
    expect(looksBinary(late)).toBe(true)
  })
})

describe("PNG", () => {
  test.each([
    "grey1.png",
    "grey16.png",
    "rgb8.png",
    "rgb16.png",
    "palette4.png",
    "rgba16.png",
    "rgb8-adam7.png",
  ])("%s: size from IHDR", (name) => {
    expect(readPng(fixture(name))).toEqual({ format: "png", width: 23, height: 13 })
  })

  test("an acTL before the image data is an APNG", () => {
    const info = readPng(fixture("anim.apng"))
    expect(info).toEqual({ format: "png", width: 23, height: 13, animated: true })
    expect(formatName(info as NonNullable<typeof info>)).toBe("APNG")
  })

  test("a scene", () => expect(readPng(fixture("before.png"))).toMatchObject({ width: 64, height: 40 }))
  test("not a PNG", () => expect(readPng(fixture("still.gif"))).toBeUndefined())
})

describe("GIF", () => {
  test.each(["still.gif", "interlaced.gif", "anim.gif"])("%s: the logical screen", (name) => {
    expect(readGif(fixture(name))).toEqual({ format: "gif", width: 64, height: 40 })
  })
})

describe("WebP", () => {
  test("lossy (VP8)", () =>
    expect(readWebp(fixture("lossy.webp"))).toEqual({ format: "webp", width: 64, height: 40 }))
  test("lossless (VP8L)", () =>
    expect(readWebp(fixture("lossless.webp"))).toEqual({ format: "webp", width: 64, height: 40 }))
  test("extended (VP8X), with alpha", () =>
    expect(readWebp(fixture("alpha.webp"))).toEqual({ format: "webp", width: 64, height: 40 }))
  test("extended, animated", () =>
    expect(readWebp(fixture("anim.webp"))).toEqual({ format: "webp", width: 64, height: 40, animated: true }))
})

describe("JPEG", () => {
  test("baseline", () =>
    expect(readJpeg(fixture("baseline.jpg"))).toEqual({ format: "jpeg", width: 64, height: 40 }))
  test("progressive", () =>
    expect(readJpeg(fixture("progressive.jpg"))).toEqual({ format: "jpeg", width: 64, height: 40 }))
  test("behind a 30 KB EXIF block", () => {
    const bytes = fixture("exif.jpg")
    expect(bytes.length).toBeGreaterThan(30_000)
    expect(readJpeg(bytes)).toEqual({ format: "jpeg", width: 64, height: 40 })
  })
  test("cut off before its size: nothing, not a guess", () => {
    expect(readJpeg(fixture("exif.jpg").subarray(0, 4096))).toBeUndefined()
  })
})

describe("BMP", () => {
  test("bottom-up", () =>
    expect(readBmp(fixture("bottomup.bmp"))).toEqual({ format: "bmp", width: 64, height: 40 }))
  test("top-down: a negative height is still a height", () =>
    expect(readBmp(fixture("topdown.bmp"))).toEqual({ format: "bmp", width: 64, height: 40 }))
  test("the OS/2 core header's 16-bit sizes", () =>
    expect(readBmp(fixture("core.bmp"))).toEqual({ format: "bmp", width: 7, height: 5 }))
})

describe("sniff", () => {
  test("names each format by its bytes, not its extension", () => {
    const names = ["rgb8.png", "anim.apng", "still.gif", "baseline.jpg", "lossy.webp", "bottomup.bmp"].map(
      (name) => {
        const info = sniff(fixture(name))
        return info ? formatName(info) : "?"
      },
    )
    expect(names).toEqual(["PNG", "APNG", "GIF", "JPEG", "WebP", "BMP"])
  })

  test("a binary that is not an image is not one", () => {
    expect(sniff(fixture("blob.bin"))).toBeUndefined()
    expect(sniff(new Uint8Array(4))).toBeUndefined()
  })

  test("only PNG and GIF decode; the rest are described", () => {
    expect(
      ["rgb8.png", "still.gif", "baseline.jpg", "lossy.webp", "bottomup.bmp"].map((name) =>
        decodable(sniff(fixture(name))),
      ),
    ).toEqual([true, true, false, false, false])
  })
})
