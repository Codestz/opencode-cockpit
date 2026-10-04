/**
 * Pictures drawn in code, for the preview CLI and the tests: a small "screenshot" of a dark UI, the
 * same with one panel changed, and the same scaled down. Real pixels through the real pipeline — the
 * shrink, the pixel diff, the cells — with no image file shipped.
 */

import type { ImageLook } from "./looks.ts"
import { comparePixels, shrink } from "./pixels.ts"
import type { Pixels } from "./png.ts"
import { finish } from "./steps.ts"

type Paint = (x: number, y: number) => [number, number, number, number]

const picture = (width: number, height: number, paint: Paint): Pixels => {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) data.set(paint(x / width, y / height), (y * width + x) * 4)
  return { width, height, data }
}

const inside = (u: number, v: number, x0: number, y0: number, x1: number, y1: number) =>
  u >= x0 && u < x1 && v >= y0 && v < y1

/** A sidebar, a header, three cards and some "text" lines — the shape of the screenshots reviews get. */
const scene =
  (changed: boolean): Paint =>
  (u, v) => {
    if (inside(u, v, 0, 0, 1, 0.08)) return [49, 50, 68, 255]
    if (inside(u, v, 0, 0.08, 0.2, 1))
      return inside(u, v, 0.02, 0.14, 0.18, 0.2) ? [137, 180, 250, 255] : [24, 24, 37, 255]
    if (inside(u, v, 0.24, 0.14, 0.48, 0.5)) return [166, 227, 161, 255]
    if (inside(u, v, 0.52, 0.14, 0.96, 0.5))
      return changed && inside(u, v, 0.7, 0.2, 0.92, 0.42) ? [243, 139, 168, 255] : [250, 179, 135, 255]
    if (inside(u, v, 0.24, 0.56, 0.96, 0.94)) {
      const row = Math.floor(v * 40)
      return row % 3 === 0 && u < 0.3 + ((row * 37) % 60) / 100 ? [205, 214, 244, 255] : [30, 30, 46, 255]
    }
    return [30, 30, 46, 255]
  }

/** A logo with a transparent background, for an added file. */
const logo: Paint = (u, v) => {
  const d = (u - 0.5) ** 2 + (v - 0.5) ** 2
  if (d < 0.16 && d > 0.09) return [203, 166, 247, 255]
  if (d < 0.05) return [148, 226, 213, 255]
  return [0, 0, 0, 0]
}

export const SAMPLE = {
  before: picture(288, 180, scene(false)),
  after: picture(288, 180, scene(true)),
  resized: picture(144, 90, scene(false)),
  logo: picture(96, 96, logo),
}

/** A look as the pane would have it once the pictures are decoded. */
export function sampleLook(before: Pixels | undefined, after: Pixels | undefined, stamp: number): ImageLook {
  const look: ImageLook = { stamp }
  if (before) look.before = finish(shrink(before))
  if (after) look.after = finish(shrink(after))
  if (before && after && look.after && before.width === after.width && before.height === after.height)
    look.diff = finish(comparePixels(before, after, look.after.width, look.after.height))
  return look
}
