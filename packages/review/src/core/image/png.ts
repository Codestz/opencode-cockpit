/**
 * PNG to RGBA, in TypeScript and `node:zlib`.
 *
 * Chunks, inflate, unfilter (None/Sub/Up/Average/Paeth), expand to 8-bit RGBA. Every colour type
 * (grey, RGB, palette, grey+alpha, RGBA), every bit depth (1/2/4/8/16), palette transparency and the
 * grey/RGB colour key, and Adam7 interlacing. Gamma and ICC are ignored: this is for a pixel diff and a
 * preview a few dozen cells wide, not for proofing colour.
 *
 * Byte-exact against PIL on every fixture in `test/image/` (the spike's twelve, up to 20.7 MB of RGBA).
 */

import { inflate, inflateSync } from "node:zlib"
import { finish, finishSoon, SLICE, type Steps } from "./steps.ts"

export interface Pixels {
  width: number
  height: number
  /** 8-bit RGBA, row-major, `width * height * 4` bytes. */
  data: Uint8Array
  /** For an animation: how many frames it has. Only the first is decoded. */
  frames?: number
}

interface PngParts {
  width: number
  height: number
  depth: number
  colour: number
  interlace: number
  palette?: Uint8Array
  trns?: Uint8Array
  /** Every IDAT's payload, joined: one zlib stream. */
  idat: Uint8Array
}

/** Samples per pixel, by colour type. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }
/** Bit depths the specification allows for each colour type. */
const DEPTHS: Record<number, number[]> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
}

const u32 = (b: Uint8Array, o: number) =>
  (b[o] as number) * 0x1000000 +
  ((b[o + 1] as number) << 16) +
  ((b[o + 2] as number) << 8) +
  (b[o + 3] as number)

function partsOf(file: Uint8Array): PngParts {
  let o = 8
  let header: Omit<PngParts, "idat" | "palette" | "trns"> | undefined
  let palette: Uint8Array | undefined
  let trns: Uint8Array | undefined
  const idat: Uint8Array[] = []
  while (o + 8 <= file.length) {
    const length = u32(file, o)
    const type = String.fromCharCode(...file.subarray(o + 4, o + 8))
    const body = file.subarray(o + 8, o + 8 + length)
    if (type === "IHDR")
      header = {
        width: u32(body, 0),
        height: u32(body, 4),
        depth: body[8] ?? 0,
        colour: body[9] ?? 0,
        interlace: body[12] ?? 0,
      }
    else if (type === "PLTE") palette = body
    else if (type === "tRNS") trns = body
    else if (type === "IDAT") idat.push(body)
    else if (type === "IEND") break
    o += 12 + length
  }
  if (!header || header.width === 0 || header.height === 0) throw new Error("not a PNG")
  if (!DEPTHS[header.colour]?.includes(header.depth))
    throw new Error(`PNG colour type ${header.colour} at ${header.depth}-bit is not valid`)
  if (header.colour === 3 && !palette) throw new Error("PNG palette missing")
  if (idat.length === 0) throw new Error("PNG has no image data")
  return { ...header, idat: idat.length === 1 ? (idat[0] as Uint8Array) : Buffer.concat(idat), palette, trns }
}

/**
 * The inflated scanlines to RGBA, a slice at a time.
 *
 * Inflate is not in here: done asynchronously it already runs off the thread (the spike's longest
 * stall inflating a 13.5 MB file was 1.2 ms), and that leaves unfiltering and expanding — the part
 * that is JavaScript, and the part that has to yield.
 */
function* unfilterPng(parts: PngParts, raw: Uint8Array): Steps<Pixels> {
  const { width, height, depth, colour, palette, trns } = parts
  const channels = CHANNELS[colour] as number
  /** Bytes per whole pixel, for the filters' "the pixel to the left". At least one, below 8-bit. */
  const bpp = Math.max(1, (channels * depth) >> 3)
  const out = new Uint8Array(width * height * 4)

  /** Grey and RGB images name one colour as transparent, at the image's own depth. */
  const key =
    trns && colour === 0 && trns.length >= 2
      ? [((trns[0] as number) << 8) | (trns[1] as number)]
      : trns && colour === 2 && trns.length >= 6
        ? [
            ((trns[0] as number) << 8) | (trns[1] as number),
            ((trns[2] as number) << 8) | (trns[3] as number),
            ((trns[4] as number) << 8) | (trns[5] as number),
          ]
        : undefined
  const max = (1 << depth) - 1
  const scale = (v: number) => (depth === 16 ? v >> 8 : depth === 8 ? v : Math.round((v * 255) / max))

  let read = 0
  let work = 0

  /** One row's samples into RGBA at its place in the image — every `dx` pixels from `x0` on row `y`. */
  const expand = (line: Uint8Array, pw: number, y: number, x0: number, dx: number) => {
    let dst = (y * width + x0) * 4
    const step = dx * 4
    /** The common cases, one branch per row rather than per pixel. */
    if (depth === 8 && colour === 6) {
      if (dx === 1) out.set(line.subarray(0, pw * 4), dst)
      else
        for (let i = 0, s = 0; i < pw; i++, s += 4, dst += step) {
          out[dst] = line[s] as number
          out[dst + 1] = line[s + 1] as number
          out[dst + 2] = line[s + 2] as number
          out[dst + 3] = line[s + 3] as number
        }
      return
    }
    if (depth === 8 && colour === 2) {
      for (let i = 0, s = 0; i < pw; i++, s += 3, dst += step) {
        const r = line[s] as number
        const g = line[s + 1] as number
        const b = line[s + 2] as number
        out[dst] = r
        out[dst + 1] = g
        out[dst + 2] = b
        out[dst + 3] = key && r === key[0] && g === key[1] && b === key[2] ? 0 : 255
      }
      return
    }
    const sample = (index: number): number => {
      if (depth === 8) return line[index] as number
      if (depth === 16) return ((line[index * 2] as number) << 8) | (line[index * 2 + 1] as number)
      const bit = index * depth
      return ((line[bit >> 3] as number) >> (8 - depth - (bit & 7))) & max
    }
    for (let i = 0; i < pw; i++, dst += step) {
      let r: number
      let g: number
      let b: number
      let a = 255
      switch (colour) {
        case 0: {
          const v = sample(i)
          r = g = b = scale(v)
          if (key && v === key[0]) a = 0
          break
        }
        case 2: {
          const vr = sample(i * 3)
          const vg = sample(i * 3 + 1)
          const vb = sample(i * 3 + 2)
          r = scale(vr)
          g = scale(vg)
          b = scale(vb)
          if (key && vr === key[0] && vg === key[1] && vb === key[2]) a = 0
          break
        }
        case 3: {
          const p = sample(i)
          r = palette?.[p * 3] ?? 0
          g = palette?.[p * 3 + 1] ?? 0
          b = palette?.[p * 3 + 2] ?? 0
          a = trns && p < trns.length ? (trns[p] as number) : 255
          break
        }
        case 4:
          r = g = b = scale(sample(i * 2))
          a = scale(sample(i * 2 + 1))
          break
        default:
          r = scale(sample(i * 4))
          g = scale(sample(i * 4 + 1))
          b = scale(sample(i * 4 + 2))
          a = scale(sample(i * 4 + 3))
      }
      out[dst] = r
      out[dst + 1] = g
      out[dst + 2] = b
      out[dst + 3] = a
    }
  }

  /** One pass of the image — all of it, or one of Adam7's seven — with a yield every slice of pixels. */
  function* pass(x0: number, y0: number, dx: number, dy: number): Steps<void> {
    const pw = Math.ceil((width - x0) / dx)
    const ph = Math.ceil((height - y0) / dy)
    if (pw <= 0 || ph <= 0) return
    const stride = Math.ceil((pw * channels * depth) / 8)
    let previous = new Uint8Array(stride)
    let current = new Uint8Array(stride)
    for (let row = 0; row < ph; row++) {
      if (read + 1 + stride > raw.length) throw new Error("PNG image data is cut short")
      const filter = raw[read++] as number
      current.set(raw.subarray(read, read + stride))
      read += stride
      unfilter(filter, current, previous, bpp)
      expand(current, pw, y0 + row * dy, x0, dx)
      const swap = previous
      previous = current
      current = swap
      work += pw
      if (work >= SLICE) {
        work = 0
        yield
      }
    }
  }

  if (parts.interlace) {
    yield* pass(0, 0, 8, 8)
    yield* pass(4, 0, 8, 8)
    yield* pass(0, 4, 4, 8)
    yield* pass(2, 0, 4, 4)
    yield* pass(0, 2, 2, 4)
    yield* pass(1, 0, 2, 2)
    yield* pass(0, 1, 1, 2)
  } else yield* pass(0, 0, 1, 1)
  return { width, height, data: out }
}

function unfilter(filter: number, cur: Uint8Array, prev: Uint8Array, bpp: number) {
  const n = cur.length
  switch (filter) {
    case 0:
      return
    case 1:
      for (let i = bpp; i < n; i++) cur[i] = ((cur[i] as number) + (cur[i - bpp] as number)) & 255
      return
    case 2:
      for (let i = 0; i < n; i++) cur[i] = ((cur[i] as number) + (prev[i] as number)) & 255
      return
    case 3:
      for (let i = 0; i < bpp; i++) cur[i] = ((cur[i] as number) + ((prev[i] as number) >> 1)) & 255
      for (let i = bpp; i < n; i++)
        cur[i] = ((cur[i] as number) + (((cur[i - bpp] as number) + (prev[i] as number)) >> 1)) & 255
      return
    case 4:
      for (let i = 0; i < bpp; i++) cur[i] = ((cur[i] as number) + (prev[i] as number)) & 255
      for (let i = bpp; i < n; i++) {
        const a = cur[i - bpp] as number
        const b = prev[i] as number
        const c = prev[i - bpp] as number
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        cur[i] = ((cur[i] as number) + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255
      }
      return
    default:
      throw new Error(`PNG row filter ${filter} does not exist`)
  }
}

/** Decodes now, on this thread. For tests and the preview CLI. */
export function decodePng(file: Uint8Array): Pixels {
  const parts = partsOf(file)
  return finish(unfilterPng(parts, inflateSync(parts.idat)))
}

const inflateOffThread = (data: Uint8Array): Promise<Uint8Array> =>
  new Promise((resolve, reject) => inflate(data, (error, out) => (error ? reject(error) : resolve(out))))

/** Decodes without holding the thread: inflate in zlib's pool, the rest in slices. For the pane. */
export async function decodePngSoon(file: Uint8Array, pause?: () => Promise<void>): Promise<Pixels> {
  const parts = partsOf(file)
  return finishSoon(unfilterPng(parts, await inflateOffThread(parts.idat)), pause)
}
