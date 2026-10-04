/**
 * Working with decoded pixels: comparing two images, shrinking one, and turning it into cells.
 *
 * Kept apart from the decoders because none of it cares where the pixels came from, and apart from
 * the view because the expensive parts — every pixel of a 2880×1800 screenshot — must run in slices
 * off the draw path, while the cheap part (a 320-pixel copy into fifty cells) runs inside a paint.
 */

import type { Pixels } from "./png.ts"
import { SLICE, type Steps } from "./steps.ts"

/**
 * A small copy of an image, kept instead of the image.
 *
 * Mid-resolution on purpose: big enough that a wider pane or a width cycle (`w`) re-derives sharper
 * cells from it in well under a millisecond, small enough (≤ 300 KB) that keeping one per side of
 * every image in a review costs nothing. Full-size pixels are dropped as soon as this exists.
 */
export interface Thumb {
  width: number
  height: number
  /** 8-bit RGBA. Alpha is kept: what it is composited over is the pane's colour, decided at paint. */
  data: Uint8Array
}

/** The largest a thumb gets, either way. */
export const THUMB_WIDTH = 320
export const THUMB_HEIGHT = 240

/** A grid over the image marking which parts changed, at the thumb's resolution. */
export interface ChangeMask {
  width: number
  height: number
  /** One byte per cell, non-zero where any pixel inside it changed. */
  data: Uint8Array
}

export interface PixelDiff {
  /** Pixels that differ by more than the tolerance in any channel. */
  changed: number
  total: number
  /** The rectangle holding every changed pixel, in the image's own pixels. */
  box?: { x: number; y: number; width: number; height: number }
  mask?: ChangeMask
}

/** Dimensions that fit inside `maxWidth × maxHeight` with the aspect kept, never larger than the source. */
export function fitWithin(width: number, height: number, maxWidth: number, maxHeight: number) {
  const scale = Math.min(1, maxWidth / width, maxHeight / height)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/**
 * Box-average downscale, every source pixel read once, colour weighted by alpha so a transparent
 * pixel's (meaningless) colour does not bleed into its neighbours.
 */
export function* shrink(source: Pixels, maxWidth = THUMB_WIDTH, maxHeight = THUMB_HEIGHT): Steps<Thumb> {
  const { width: w, height: h } = fitWithin(source.width, source.height, maxWidth, maxHeight)
  const out = new Uint8Array(w * h * 4)
  const r = new Float64Array(w)
  const g = new Float64Array(w)
  const b = new Float64Array(w)
  const a = new Float64Array(w)
  const n = new Float64Array(w)
  const column = new Uint32Array(source.width)
  for (let x = 0; x < source.width; x++) column[x] = Math.min(w - 1, Math.floor((x * w) / source.width))
  const d = source.data
  let work = 0
  for (let ty = 0; ty < h; ty++) {
    r.fill(0)
    g.fill(0)
    b.fill(0)
    a.fill(0)
    n.fill(0)
    const y0 = Math.floor((ty * source.height) / h)
    const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * source.height) / h))
    for (let y = y0; y < y1; y++) {
      for (let x = 0, i = y * source.width * 4; x < source.width; x++, i += 4) {
        const tx = column[x] as number
        const alpha = d[i + 3] as number
        r[tx] = (r[tx] as number) + (d[i] as number) * alpha
        g[tx] = (g[tx] as number) + (d[i + 1] as number) * alpha
        b[tx] = (b[tx] as number) + (d[i + 2] as number) * alpha
        a[tx] = (a[tx] as number) + alpha
        n[tx] = (n[tx] as number) + 1
      }
    }
    for (let tx = 0; tx < w; tx++) {
      const weight = a[tx] as number
      const o = (ty * w + tx) * 4
      if (weight > 0) {
        out[o] = Math.round((r[tx] as number) / weight)
        out[o + 1] = Math.round((g[tx] as number) / weight)
        out[o + 2] = Math.round((b[tx] as number) / weight)
      }
      out[o + 3] = Math.round(weight / ((n[tx] as number) || 1))
    }
    work += (y1 - y0) * source.width
    if (work >= SLICE / 2) {
      work = 0
      yield
    }
  }
  return { width: w, height: h, data: out }
}

/**
 * Two same-size images compared pixel by pixel, at full resolution.
 *
 * Words first: identical pixels — nearly all of a re-taken screenshot — cost one 32-bit compare, and
 * only a mismatch is checked per channel against `tolerance`, which absorbs an encoder's rounding.
 * 6 ms for 2880×1800 in the spike. The mask is built on the way, at `maskWidth × maskHeight`, so the
 * preview can light the cells that changed without a second pass over the pixels.
 */
export function* comparePixels(
  before: Pixels,
  after: Pixels,
  maskWidth: number,
  maskHeight: number,
  tolerance = 8,
): Steps<PixelDiff> {
  if (before.width !== after.width || before.height !== after.height)
    throw new Error("a pixel diff needs two images of one size")
  const { width, height } = after
  const da = before.data
  const db = after.data
  const wa = new Uint32Array(da.buffer, da.byteOffset, da.length >> 2)
  const wb = new Uint32Array(db.buffer, db.byteOffset, db.length >> 2)
  const mask = new Uint8Array(maskWidth * maskHeight)
  const mx = new Uint32Array(width)
  for (let x = 0; x < width; x++) mx[x] = Math.min(maskWidth - 1, Math.floor((x * maskWidth) / width))
  let changed = 0
  let x0 = width
  let y0 = height
  let x1 = -1
  let y1 = -1
  let work = 0
  for (let y = 0, p = 0; y < height; y++) {
    const row = Math.min(maskHeight - 1, Math.floor((y * maskHeight) / height)) * maskWidth
    for (let x = 0; x < width; x++, p++) {
      if (wa[p] === wb[p]) continue
      const i = p * 4
      if (
        Math.abs((da[i] as number) - (db[i] as number)) > tolerance ||
        Math.abs((da[i + 1] as number) - (db[i + 1] as number)) > tolerance ||
        Math.abs((da[i + 2] as number) - (db[i + 2] as number)) > tolerance ||
        Math.abs((da[i + 3] as number) - (db[i + 3] as number)) > tolerance
      ) {
        changed++
        mask[row + (mx[x] as number)] = 1
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
    work += width
    if (work >= SLICE * 2) {
      work = 0
      yield
    }
  }
  return {
    changed,
    total: width * height,
    ...(changed > 0
      ? {
          box: { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 },
          mask: { width: maskWidth, height: maskHeight, data: mask },
        }
      : {}),
  }
}

/**
 * A picture in half-block cells: `▀` with the top pixel as ink and the bottom as background, so one
 * cell is two square-ish pixels. Colours are packed `0xRRGGBB`.
 */
export interface Cells {
  cols: number
  rows: number
  top: Uint32Array
  bottom: Uint32Array
}

/** The grid of pixels (one column × half a row each) a picture takes inside `cols × rows` cells. */
export function cellGrid(width: number, height: number, cols: number, rows: number) {
  const fit = fitWithin(width, height, cols, rows * 2)
  /** A cell holds two pixels, so the height rounds to whole cells — never less than one. */
  return { width: fit.width, height: Math.max(2, fit.height + (fit.height % 2)) }
}

/** `colour` pulled `amount` of the way toward `toward`. */
export const mix = (colour: number, toward: number, amount: number): number => {
  const channel = (shift: number) =>
    Math.round(((colour >> shift) & 255) * (1 - amount) + ((toward >> shift) & 255) * amount)
  return (channel(16) << 16) | (channel(8) << 8) | channel(0)
}

/** How far an unchanged part of a picture is faded, so the change is what the eye lands on. */
export const FADE = 0.55

/**
 * A thumb as cells inside `cols × rows`, composited over `canvas` (the pane's own colour).
 *
 * With a mask, every pixel whose part of the image did not change is faded toward the canvas: the
 * picture stays recognisable, and what changed is the only thing at full strength.
 */
export function toCells(thumb: Thumb, cols: number, rows: number, canvas: number, mask?: ChangeMask): Cells {
  const grid = cellGrid(thumb.width, thumb.height, cols, rows)
  const w = grid.width
  const h = grid.height
  const px = new Uint32Array(w * h)
  const d = thumb.data
  const cr = (canvas >> 16) & 255
  const cg = (canvas >> 8) & 255
  const cb = canvas & 255
  for (let ty = 0; ty < h; ty++) {
    const y0 = Math.floor((ty * thumb.height) / h)
    const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * thumb.height) / h))
    for (let tx = 0; tx < w; tx++) {
      const x0 = Math.floor((tx * thumb.width) / w)
      const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * thumb.width) / w))
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let y = y0; y < y1; y++)
        for (let x = x0, i = (y * thumb.width + x0) * 4; x < x1; x++, i += 4) {
          const alpha = (d[i + 3] as number) / 255
          r += (d[i] as number) * alpha + cr * (1 - alpha)
          g += (d[i + 1] as number) * alpha + cg * (1 - alpha)
          b += (d[i + 2] as number) * alpha + cb * (1 - alpha)
          n++
        }
      let colour = (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n)
      if (mask && !maskHit(mask, tx / w, ty / h, (tx + 1) / w, (ty + 1) / h))
        colour = mix(colour, canvas, FADE)
      px[ty * w + tx] = colour
    }
  }
  const cellRows = h / 2
  const top = new Uint32Array(w * cellRows)
  const bottom = new Uint32Array(w * cellRows)
  for (let row = 0; row < cellRows; row++)
    for (let x = 0; x < w; x++) {
      top[row * w + x] = px[row * 2 * w + x] as number
      bottom[row * w + x] = px[(row * 2 + 1) * w + x] as number
    }
  return { cols: w, rows: cellRows, top, bottom }
}

/** Whether any marked cell of the mask falls inside this fraction of the image. */
function maskHit(mask: ChangeMask, fx0: number, fy0: number, fx1: number, fy1: number): boolean {
  const x0 = Math.floor(fx0 * mask.width)
  const y0 = Math.floor(fy0 * mask.height)
  const x1 = Math.max(x0 + 1, Math.ceil(fx1 * mask.width))
  const y1 = Math.max(y0 + 1, Math.ceil(fy1 * mask.height))
  for (let y = y0; y < y1 && y < mask.height; y++)
    for (let x = x0; x < x1 && x < mask.width; x++) if (mask.data[y * mask.width + x]) return true
  return false
}
