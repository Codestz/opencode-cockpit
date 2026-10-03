/**
 * A GIF's first frame to RGBA, and how many frames it has.
 *
 * LZW, global and local colour tables, interlacing, the transparent index. Only the first frame is
 * drawn — a review asks "what does it look like", and a frame counter answers "is it animated" — but
 * every frame is walked over so the count is true. Byte-exact against PIL on the spike's fixtures.
 */

import type { Pixels } from "./png.ts"
import { finish, finishSoon, SLICE, type Steps } from "./steps.ts"

const u16 = (b: Uint8Array, o: number) => (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8)

function* gifSteps(b: Uint8Array): Steps<Pixels> {
  if (b.length < 13 || String.fromCharCode(...b.subarray(0, 4)) !== "GIF8") throw new Error("not a GIF")
  const width = u16(b, 6)
  const height = u16(b, 8)
  if (width === 0 || height === 0) throw new Error("GIF has no pixels")
  const flags = b[10] as number
  let o = 13
  let global: Uint8Array | undefined
  if (flags & 0x80) {
    const size = 3 << ((flags & 7) + 1)
    global = b.subarray(o, o + size)
    o += size
  }
  const out = new Uint8Array(width * height * 4)
  let transparent = -1
  let frames = 0
  let decoded = false
  /** Skips a run of sub-blocks, each a length byte and that many bytes, ended by a zero. */
  const skipBlocks = () => {
    while (o < b.length && b[o] !== 0) o += (b[o] as number) + 1
    o++
  }
  while (o < b.length) {
    const block = b[o++] as number
    if (block === 0x3b) break
    if (block === 0x21) {
      const label = b[o++] as number
      /** The graphic control extension before the first image says which index is see-through. */
      if (label === 0xf9 && !decoded && ((b[o + 1] ?? 0) & 1) === 1) transparent = b[o + 4] ?? -1
      skipBlocks()
      continue
    }
    if (block !== 0x2c) throw new Error("GIF block not understood")
    frames++
    const left = u16(b, o)
    const top = u16(b, o + 2)
    const fw = u16(b, o + 4)
    const fh = u16(b, o + 6)
    const frameFlags = b[o + 8] ?? 0
    o += 9
    let table = global
    if (frameFlags & 0x80) {
      const size = 3 << ((frameFlags & 7) + 1)
      table = b.subarray(o, o + size)
      o += size
    }
    const minCode = b[o++] ?? 2
    if (decoded) {
      skipBlocks()
      continue
    }
    const parts: Uint8Array[] = []
    let total = 0
    while (o < b.length && b[o] !== 0) {
      const n = b[o] as number
      parts.push(b.subarray(o + 1, o + 1 + n))
      total += n
      o += n + 1
    }
    o++
    const data = new Uint8Array(total)
    let written = 0
    for (const part of parts) {
      data.set(part, written)
      written += part.length
    }
    const indices = yield* lzw(data, minCode, fw * fh)
    const rows = frameFlags & 0x40 ? interlaceOrder(fh) : undefined
    for (let y = 0; y < fh; y++) {
      const dy = top + (rows ? (rows[y] as number) : y)
      if (dy >= height) continue
      for (let x = 0; x < fw; x++) {
        const dx = left + x
        if (dx >= width) continue
        const index = indices[y * fw + x] as number
        if (index === transparent) continue
        const d = (dy * width + dx) * 4
        out[d] = table?.[index * 3] ?? 0
        out[d + 1] = table?.[index * 3 + 1] ?? 0
        out[d + 2] = table?.[index * 3 + 2] ?? 0
        out[d + 3] = 255
      }
    }
    decoded = true
    yield
  }
  if (!decoded) throw new Error("GIF has no image")
  return { width, height, data: out, frames }
}

/** The four passes of an interlaced GIF, as the order its rows arrive in. */
function interlaceOrder(h: number): number[] {
  const rows: number[] = []
  for (const [start, step] of [
    [0, 8],
    [4, 8],
    [2, 4],
    [1, 2],
  ] as const)
    for (let y = start; y < h; y += step) rows.push(y)
  return rows
}

/** GIF's variable-width LZW to colour indices, yielding every slice of output. */
function* lzw(data: Uint8Array, minCode: number, count: number): Steps<Uint8Array> {
  const out = new Uint8Array(count)
  const clear = 1 << minCode
  const end = clear + 1
  const prefix = new Int16Array(4096)
  const suffix = new Uint8Array(4096)
  const first = new Uint8Array(4096)
  const stack = new Uint8Array(4097)
  let size = minCode + 1
  let mask = (1 << size) - 1
  let next = end + 1
  let old = -1
  let bits = 0
  let acc = 0
  let pos = 0
  let w = 0
  let work = 0
  for (let i = 0; i < clear; i++) {
    prefix[i] = -1
    suffix[i] = i
    first[i] = i
  }
  while (w < count) {
    while (bits < size) {
      if (pos >= data.length) return out
      acc |= (data[pos++] as number) << bits
      bits += 8
    }
    const code = acc & mask
    acc >>>= size
    bits -= size
    if (code === clear) {
      size = minCode + 1
      mask = (1 << size) - 1
      next = end + 1
      old = -1
      continue
    }
    if (code === end) break
    if (old === -1) {
      out[w++] = suffix[code] as number
      old = code
      continue
    }
    let c = code
    let sp = 0
    if (code >= next) {
      stack[sp++] = first[old] as number
      c = old
    }
    while (c >= clear) {
      stack[sp++] = suffix[c] as number
      c = prefix[c] as number
    }
    stack[sp++] = suffix[c] as number
    if (next < 4096) {
      prefix[next] = old
      suffix[next] = first[c] as number
      first[next] = first[old] as number
      next++
      if ((next & mask) === 0 && next < 4096) {
        size++
        mask = (1 << size) - 1
      }
    }
    const before = w
    while (sp > 0 && w < count) out[w++] = stack[--sp] as number
    old = code
    work += w - before
    if (work >= SLICE) {
      work = 0
      yield
    }
  }
  return out
}

/** Decodes now, on this thread. For tests and the preview CLI. */
export const decodeGif = (file: Uint8Array): Pixels => finish(gifSteps(file))

/** Decodes a slice at a time, giving the event loop back between them. For the pane. */
export const decodeGifSoon = (file: Uint8Array, pause?: () => Promise<void>): Promise<Pixels> =>
  finishSoon(gifSteps(file), pause)
