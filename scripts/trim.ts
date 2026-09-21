#!/usr/bin/env bun
/**
 * Cuts spans out of a cast, leaving the screen correct on the other side.
 *
 *   bun scripts/trim.ts tapes/review.cast --drop 50-119
 *
 * A terminal recording is a stream of deltas, so you cannot simply delete the middle of one — the
 * frames after the cut describe a screen built by the frames you removed. This replays the recording,
 * and where a span is dropped it writes the screen as it stood at the far edge of the cut before
 * carrying on. What you see is a jump cut: every frame still real, and the waiting gone.
 *
 * The tape it was written for waits on a model. Recording generously and cutting the wait afterwards
 * beats tuning the wait until the demo is a race the model sometimes loses.
 */

import { SerializeAddon } from "@xterm/addon-serialize"
import { Terminal } from "@xterm/headless"

const args = process.argv.slice(2)
const path = args[0]
if (!path) {
  console.error("usage: bun scripts/trim.ts <cast> --drop <from>-<to> [--drop ...] [--gap 0.5]")
  process.exit(1)
}
const drops = args
  .flatMap((arg, at) => (arg === "--drop" ? [args[at + 1]] : []))
  .filter((span): span is string => Boolean(span))
  .map((span) => span.split("-").map(Number) as [number, number])
  .sort((a, b) => a[0] - b[0])
const gapAt = args.indexOf("--gap")
/** How long the cut itself lasts on screen: long enough to read as a cut, short enough to be one. */
const gap = gapAt === -1 ? 0.5 : Number(args[gapAt + 1])

const lines = (await Bun.file(path).text()).split("\n").filter(Boolean)
const header = JSON.parse(lines[0] as string) as { width: number; height: number }
const events = lines.slice(1).map((line) => JSON.parse(line) as [number, string, string])

const term = new Terminal({ cols: header.width, rows: header.height, allowProposedApi: true })
const serializer = new SerializeAddon()
term.loadAddon(serializer)

const out: string[] = []
let shift = 0
let cut = 0
const dropped = (at: number) => drops.find(([from, to]) => at >= from && at <= to)

for (const [at, kind, text] of events) {
  term.write(text)
  const span = dropped(at)
  if (span) {
    /** Inside a cut: the terminal still needs the bytes, but nobody watches them. */
    if (cut !== span[0]) {
      cut = span[0]
    }
    continue
  }
  if (cut) {
    /** Just past a cut: hand the player the screen it would have had, in one frame. */
    await new Promise<void>((done) => term.write("", done))
    const [from, to] = drops.find(([start]) => start === cut) as [number, number]
    shift += to - from - gap
    out.push(
      `[${(from + gap - (shift - (to - from - gap))).toFixed(3)}, "o", ${JSON.stringify(`\x1b[2J\x1b[H${serializer.serialize()}`)}]`,
    )
    cut = 0
  }
  out.push(`[${(at - shift).toFixed(3)}, ${JSON.stringify(kind)}, ${JSON.stringify(text)}]`)
}

const was = events.at(-1)?.[0] ?? 0
await Bun.write(path, `${lines[0]}\n${out.join("\n")}\n`)
console.log(`${path}: ${was.toFixed(1)}s → ${(was - shift).toFixed(1)}s (${drops.length} cut)`)
