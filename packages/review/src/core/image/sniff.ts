/**
 * What a file is, from its first bytes: binary or text, and — for an image — its format and size.
 *
 * No decoding. Every reader here looks at a few dozen bytes of header, so it costs nothing to run on
 * every binary in a review (0.08 ms measured, docs/opencode/images.md), and it is what turns "a PNG
 * shown as four hundred lines of U+FFFD" into one true sentence about it.
 *
 * Checked against PIL and `sips` on every fixture in `test/image/`: each PNG colour type and depth,
 * interlaced, APNG, baseline and progressive JPEG, a JPEG whose size sits behind a 30 KB EXIF block,
 * lossy, lossless and extended WebP, BMP.
 */

export type ImageFormat = "png" | "jpeg" | "gif" | "webp" | "bmp"

export interface ImageInfo {
  format: ImageFormat
  width: number
  height: number
  /** An APNG, an animated WebP. A GIF's frames are only known once it is decoded. */
  animated?: boolean
}

/** How many bytes git looks at to decide a file is binary, and how many this bay does. */
export const BINARY_PROBE = 8000

/**
 * Git's own rule: a NUL in the first 8000 bytes means binary.
 *
 * The same rule as git so the two never disagree about a file — a file `git diff` calls binary and
 * this bay drew as text (or the other way round) would be two answers to one question.
 */
export const looksBinary = (bytes: Uint8Array): boolean => bytes.subarray(0, BINARY_PROBE).indexOf(0) !== -1

/** Enough of a file to find a JPEG's size behind its EXIF and ICC blocks, which come first. */
export const HEADER_BYTES = 64 * 1024

const at = (b: Uint8Array, o: number): number => b[o] ?? 0
const u16be = (b: Uint8Array, o: number) => (at(b, o) << 8) | at(b, o + 1)
const u16le = (b: Uint8Array, o: number) => at(b, o) | (at(b, o + 1) << 8)
const u24le = (b: Uint8Array, o: number) => at(b, o) | (at(b, o + 1) << 8) | (at(b, o + 2) << 16)
const u32be = (b: Uint8Array, o: number) =>
  at(b, o) * 0x1000000 + (at(b, o + 1) << 16) + (at(b, o + 2) << 8) + at(b, o + 3)
const u32le = (b: Uint8Array, o: number) =>
  at(b, o) + (at(b, o + 1) << 8) + (at(b, o + 2) << 16) + at(b, o + 3) * 0x1000000
const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n))

/** PNG: the signature, then IHDR — always the first chunk. An `acTL` before the image data is an APNG. */
export function readPng(b: Uint8Array): ImageInfo | undefined {
  if (b.length < 33 || at(b, 0) !== 0x89 || ascii(b, 1, 3) !== "PNG" || ascii(b, 12, 4) !== "IHDR")
    return undefined
  let animated = false
  for (let o = 8; o + 8 <= b.length; ) {
    const type = ascii(b, o + 4, 4)
    if (type === "acTL") animated = true
    if (type === "IDAT" || type === "IEND") break
    o += 12 + u32be(b, o)
  }
  return { format: "png", width: u32be(b, 16), height: u32be(b, 20), ...(animated ? { animated } : {}) }
}

/** GIF: the logical screen descriptor, right after the signature. */
export function readGif(b: Uint8Array): ImageInfo | undefined {
  if (b.length < 10 || ascii(b, 0, 4) !== "GIF8") return undefined
  return { format: "gif", width: u16le(b, 6), height: u16le(b, 8) }
}

/**
 * WebP: three containers, three places for the size.
 *
 * `VP8 ` (lossy) keeps 14-bit fields after its start code; `VP8L` (lossless) packs both into one
 * little-endian word; `VP8X` (extended — alpha, animation) stores each less one in 24 bits.
 */
export function readWebp(b: Uint8Array): ImageInfo | undefined {
  if (b.length < 16 || ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WEBP") return undefined
  const kind = ascii(b, 12, 4)
  if (kind === "VP8 " && b.length >= 30)
    return { format: "webp", width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff }
  if (kind === "VP8L" && b.length >= 25) {
    const bits = u32le(b, 21)
    return { format: "webp", width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
  }
  if (kind === "VP8X" && b.length >= 30) {
    const animated = (at(b, 20) & 0x02) !== 0
    return {
      format: "webp",
      width: u24le(b, 24) + 1,
      height: u24le(b, 27) + 1,
      ...(animated ? { animated } : {}),
    }
  }
  return undefined
}

/**
 * JPEG: walk the markers to the first start-of-frame.
 *
 * Any SOF0–SOF15 carries the size, except C4 (Huffman tables), C8 (reserved) and CC (arithmetic
 * conditioning), which share the range. EXIF and ICC segments come first and can be tens of KB, so
 * the size may be far in — `HEADER_BYTES` covers what cameras and screenshot tools write.
 */
export function readJpeg(b: Uint8Array): ImageInfo | undefined {
  if (b.length < 4 || at(b, 0) !== 0xff || at(b, 1) !== 0xd8) return undefined
  let o = 2
  while (o + 9 < b.length) {
    if (at(b, o) !== 0xff) return undefined
    const marker = at(b, o + 1)
    /** Fill bytes, and markers that stand alone with no length after them. */
    if (marker === 0xff) {
      o++
      continue
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      o += 2
      continue
    }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
      return { format: "jpeg", height: u16be(b, o + 5), width: u16be(b, o + 7) }
    o += 2 + u16be(b, o + 2)
  }
  return undefined
}

/**
 * BMP: the DIB header after the 14-byte file header.
 *
 * The old OS/2 core header (12 bytes) has 16-bit sizes; every later one 32-bit, with a negative
 * height for an image stored top-down.
 */
export function readBmp(b: Uint8Array): ImageInfo | undefined {
  if (b.length < 26 || at(b, 0) !== 0x42 || at(b, 1) !== 0x4d) return undefined
  const dib = u32le(b, 14)
  if (dib === 12) return { format: "bmp", width: u16le(b, 18), height: u16le(b, 20) }
  if (dib < 40) return undefined
  return { format: "bmp", width: u32le(b, 18) | 0, height: Math.abs(u32le(b, 22) | 0) }
}

/** The image a header describes, or undefined for anything this bay cannot name. */
export function sniff(bytes: Uint8Array): ImageInfo | undefined {
  const found =
    readPng(bytes) ?? readGif(bytes) ?? readWebp(bytes) ?? readJpeg(bytes) ?? readBmp(bytes) ?? undefined
  /** A header that claims no pixels is a damaged file, not an image to describe. */
  return found && found.width > 0 && found.height > 0 ? found : undefined
}

/** The format as people write it: `PNG`, `APNG`, `JPEG`, `GIF`, `WebP`, `BMP`. */
export function formatName(info: ImageInfo): string {
  if (info.format === "png") return info.animated ? "APNG" : "PNG"
  if (info.format === "webp") return "WebP"
  return info.format.toUpperCase()
}

/** Formats this bay can decode to pixels — for a pixel diff and a preview. JPEG and WebP are metadata only. */
export const decodable = (info: ImageInfo | undefined): boolean =>
  info?.format === "png" || info?.format === "gif"
