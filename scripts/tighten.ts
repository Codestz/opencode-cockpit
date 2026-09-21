#!/usr/bin/env bun
/**
 * Caps the silences in a cast, so a recording can afford to wait.
 *
 *   bun scripts/tighten.ts tapes/review.cast 1.8
 *
 * A tape that waits on a model has to allow for its slowest turn, which leaves the recording full of
 * dead air on its fastest. Rather than tune the waits until the demo is a race against the model,
 * record generously and shorten the gaps afterwards: every frame is kept, in order, and only the
 * time between them is pulled in. Nothing is faked — it is the same session, watched less patiently.
 */

const [path, cap = "1.8"] = process.argv.slice(2)
if (!path) {
  console.error("usage: bun scripts/tighten.ts <cast> [maxGapSeconds]")
  process.exit(1)
}
const max = Number.parseFloat(cap)

const lines = (await Bun.file(path).text()).split("\n").filter(Boolean)
const header = lines[0] as string
const events = lines.slice(1).map((line) => JSON.parse(line) as [number, string, string])

let previous = 0
let shift = 0
const out: string[] = []
for (const [at, kind, text] of events) {
  const gap = at - previous
  if (gap > max) shift += gap - max
  previous = at
  out.push(`[${(at - shift).toFixed(3)}, ${JSON.stringify(kind)}, ${JSON.stringify(text)}]`)
}

const was = events.at(-1)?.[0] ?? 0
const now = was - shift
await Bun.write(path, `${header}\n${out.join("\n")}\n`)
console.log(`${path}: ${was.toFixed(1)}s → ${now.toFixed(1)}s (gaps capped at ${max}s)`)
