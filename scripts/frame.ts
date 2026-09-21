#!/usr/bin/env bun
/**
 * Prints the screen a cast shows at a given moment.
 *
 *   bun scripts/frame.ts tapes/review.cast 12.5
 *   bun scripts/frame.ts tapes/review.cast 12.5 --raw   # keep the colours
 *
 * Tapes are written blind: you script keystrokes, wait, and find out afterwards whether the dialog
 * you meant to open was open. Replaying the recording into a headless terminal turns that into
 * something you can look at, which is the difference between tuning a tape and guessing at it.
 */

import { SerializeAddon } from "@xterm/addon-serialize"
import { Terminal } from "@xterm/headless"

const [path, at, ...rest] = process.argv.slice(2)
if (!path || at === undefined) {
  console.error("usage: bun scripts/frame.ts <cast> <seconds> [--raw]")
  process.exit(1)
}
const until = Number.parseFloat(at)
const raw = rest.includes("--raw")

const lines = (await Bun.file(path).text()).split("\n").filter(Boolean)
const header = JSON.parse(lines[0] as string) as { width: number; height: number }
const term = new Terminal({ cols: header.width, rows: header.height, allowProposedApi: true })
const serializer = new SerializeAddon()
term.loadAddon(serializer)

for (const line of lines.slice(1)) {
  const [time, , text] = JSON.parse(line) as [number, string, string]
  if (time > until) break
  term.write(text)
}
await new Promise<void>((done) => term.write("", done))

const screen = serializer.serialize()
/** The escape introducer by code point: a literal one in a pattern is unreadable and lint says so. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;:]*[a-zA-Z]`, "g")
console.log(raw ? screen : screen.replace(ANSI, ""))
