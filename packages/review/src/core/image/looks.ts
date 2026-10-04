/**
 * Looking at changed images: decode, compare, keep a small copy — off the draw path, and once.
 *
 * The pane shows a binary's metadata the moment git is read; this is what fills in the rest when it
 * is ready — the pixel diff and the two thumbs the preview is drawn from. Decoding a screenshot costs
 * 50–100 ms, so it never happens inside a paint: it runs here, in slices (`steps.ts`), one file at a
 * time, and asks for a paint when each file is done.
 *
 * Cached by the bytes' hash, not by path: reloading the review (`g`, a source switch) re-reads the
 * bytes — 8 ms through git — and finds every picture it has already decoded.
 */

import type { FileChange } from "../model/review.ts"
import { decodeGifSoon } from "./gif.ts"
import { comparePixels, type PixelDiff, shrink, type Thumb } from "./pixels.ts"
import { decodePngSoon, type Pixels } from "./png.ts"
import { decodable, type ImageInfo, sniff } from "./sniff.ts"
import { finishSoon, turn } from "./steps.ts"

/**
 * Past this many pixels a side is described and not decoded: 4096×4096, 64 MB of RGBA. A 5K
 * screenshot (5120×2880) fits; a print-resolution scan does not, and `o` is the answer for it.
 */
export const MAX_PIXELS = 4096 * 4096

/** What a pane can show of an image change beyond its metadata. */
export interface ImageLook {
  /** Still working: the card says so where the preview will appear. */
  pending?: boolean
  before?: Thumb
  after?: Thumb
  /** Only for two decodable images of the same size: anything else would be a percentage that lies. */
  diff?: PixelDiff
  /** Frames in an animation, when there is more than one. */
  frames?: { before?: number; after?: number }
  /** Why there is no picture where there could have been one. */
  problem?: string
  /** Changes whenever the look does, so a cached row knows it is stale. */
  stamp: number
}

export type Side = "before" | "after"

/** Reads one side's bytes in full, or undefined when there is nothing to read (or too much). */
export type ReadSide = (file: FileChange, side: Side) => Promise<Uint8Array | undefined>

/** Whether a file has anything worth decoding: an image this bay can decode on at least one side. */
export const worthLooking = (file: FileChange): boolean =>
  file.binary !== undefined && (decodable(file.binary.before?.image) || decodable(file.binary.after?.image))

const tooBig = (info: ImageInfo | undefined): boolean =>
  info !== undefined && info.width * info.height > MAX_PIXELS

/** Said where the picture would be; the card's `[o]` right under it is the way to see it anyway. */
export const tooLargeText = (width: number, height: number): string =>
  `Too large to preview here — ${Math.round((width * height) / 1e6)} megapixels, past ${Math.round(MAX_PIXELS / 1e6)}`

interface Decoded {
  thumb: Thumb
  frames?: number
}

/** Small copies by content hash, so a reload never decodes twice. Thumbs are ≤ 300 KB each. */
const thumbs = new Map<string, Decoded>()
const diffs = new Map<string, PixelDiff>()
const REMEMBERED = 48

const remember = <T>(map: Map<string, T>, key: string, value: T) => {
  if (map.size >= REMEMBERED) {
    const oldest = map.keys().next().value
    if (oldest !== undefined) map.delete(oldest)
  }
  map.set(key, value)
}

const hashOf = (bytes: Uint8Array): string => `${Bun.hash(bytes).toString(36)}:${bytes.length}`

const decode = (info: ImageInfo, bytes: Uint8Array, pause: () => Promise<void>): Promise<Pixels> =>
  info.format === "png" ? decodePngSoon(bytes, pause) : decodeGifSoon(bytes, pause)

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

let stamps = 0

/**
 * Everything worth showing about one image change: thumbs for whichever sides decode, and the pixel
 * diff when both do and their dimensions match.
 */
export async function analyse(
  file: FileChange,
  read: ReadSide,
  pause: () => Promise<void> = turn,
): Promise<ImageLook> {
  const binary = file.binary
  const look: ImageLook = { stamp: ++stamps }
  if (!binary) return look
  const sides: Side[] = ["before", "after"]
  const problems: string[] = []
  const named = (side: Side) => (side === "before" ? "old" : "new")

  /** Both sides' bytes first: reading is cheap, and the hashes decide what needs decoding at all. */
  const bytes: Partial<Record<Side, { data: Uint8Array; info: ImageInfo; hash: string }>> = {}
  for (const side of sides) {
    const info = binary[side]?.image
    if (!info || !decodable(info)) continue
    if (tooBig(info)) {
      problems.push(tooLargeText(info.width, info.height))
      continue
    }
    const data = await read(file, side)
    /** Sniffed again: the working copy may have moved on since git was read. */
    const now = data ? sniff(data) : undefined
    if (!data || !now || now.format !== info.format || tooBig(now)) {
      problems.push(`the ${named(side)} side could not be read`)
      continue
    }
    bytes[side] = { data, info: now, hash: hashOf(data) }
  }

  const before = bytes.before
  const after = bytes.after
  const pair =
    before && after && before.info.width === after.info.width && before.info.height === after.info.height
      ? `${before.hash}>${after.hash}`
      : undefined
  /** The full pixels are only kept when a diff needs them and none is cached. */
  const comparing = pair !== undefined && !diffs.has(pair)
  const full: Partial<Record<Side, Pixels>> = {}

  for (const side of sides) {
    const got = bytes[side]
    if (!got) continue
    let known = thumbs.get(got.hash)
    if (!known || comparing) {
      try {
        const pixels = await decode(got.info, got.data, pause)
        if (comparing) full[side] = pixels
        known ??= {
          thumb: await finishSoon(shrink(pixels), pause),
          ...(pixels.frames && pixels.frames > 1 ? { frames: pixels.frames } : {}),
        }
        remember(thumbs, got.hash, known)
      } catch (error) {
        problems.push(`could not decode the ${named(side)} side: ${message(error)}`)
        continue
      }
    }
    look[side] = known.thumb
    if (known.frames) look.frames = { ...look.frames, [side]: known.frames }
  }

  if (pair) {
    const cached = diffs.get(pair)
    if (cached) look.diff = cached
    else if (full.before && full.after && look.after) {
      const diff = await finishSoon(
        comparePixels(full.before, full.after, look.after.width, look.after.height),
        pause,
      )
      remember(diffs, pair, diff)
      look.diff = diff
    }
  }
  if (problems[0]) look.problem = problems[0]
  return look
}

export interface Looks {
  /** What is known about each image change, by path. A new map whenever anything in it changes. */
  current: () => ReadonlyMap<string, ImageLook>
  /** Starts looking at these files' images, one at a time; a later call supersedes an earlier one. */
  sync: (files: readonly FileChange[]) => void
}

/**
 * The pane's view of the images under review.
 *
 * `changed` asks for a paint. A file being worked on keeps what it showed before, marked pending,
 * so a reload does not blank every preview on screen and draw them back one by one.
 */
export function createLooks(read: ReadSide, changed: () => void, pause: () => Promise<void> = turn): Looks {
  let looks: ReadonlyMap<string, ImageLook> = new Map()
  let generation = 0

  const put = (path: string, look: ImageLook | undefined) => {
    const next = new Map(looks)
    if (look) next.set(path, look)
    else next.delete(path)
    looks = next
  }

  return {
    current: () => looks,
    sync(files) {
      const mine = ++generation
      const wanted = files.filter(worthLooking)
      /** Files no longer in the review are forgotten; the rest show "decoding…" until they are done. */
      const kept = new Map<string, ImageLook>()
      for (const file of wanted)
        kept.set(file.path, { ...(looks.get(file.path) ?? {}), pending: true, stamp: ++stamps })
      looks = kept
      if (wanted.length > 0) changed()
      void (async () => {
        for (const file of wanted) {
          const look = await analyse(file, read, pause).catch(
            (error): ImageLook => ({ problem: message(error), stamp: ++stamps }),
          )
          if (mine !== generation) return
          put(file.path, look)
          changed()
        }
      })()
    },
  }
}
