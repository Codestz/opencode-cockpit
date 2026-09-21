#!/usr/bin/env bun

/**
 * What the review costs, measured, with no OpenCode running.
 *
 *   bun packages/review/src/cli/bench.ts
 *   bun packages/review/src/cli/bench.ts --lines 8000 --frames 2000 --width 210
 *
 * Bottleneck hunting belongs here rather than in the terminal: a scroll that feels bad tells you the
 * frame was slow and nothing about which part of it was, and the pane's own footer (`p`) can only show
 * what has already happened to you. This drives the same `layout` the pane drives, at whatever size and
 * for as many frames as you like, and prints the spread.
 *
 * It measures composition, not assignment — everything up to the point where rows become styled text.
 * That is deliberate: the assignment half needs a renderer, and the half that can be measured without
 * one is the half we can change.
 */

import type { ChangeSet } from "../core/model/review.ts"
import { emptyReview, open as openThread } from "../core/model/review.ts"
import { metrics } from "../core/perf.ts"
import { layout } from "../core/view/layout.ts"
import { statsLines } from "../core/view/stats.ts"

const args = process.argv.slice(2).filter((arg) => arg !== "bench")
const number = (name: string, fallback: number): number => {
  const at = args.indexOf(`--${name}`)
  const value = at === -1 ? undefined : Number(args[at + 1])
  return value === undefined || Number.isNaN(value) ? fallback : value
}

if (args.includes("--help")) {
  console.log(`
  bench — what a frame of the review costs

    --lines <n>    how long the file under the cursor is (default: 3000)
    --files <n>    how many files in the change set (default: 40)
    --frames <n>   how many frames to draw (default: 1000)
    --width <n>    columns (default: 210)
    --height <n>   rows (default: 40)
    --threads <n>  how many notes are on the file (default: 6)
`)
  process.exit(0)
}

const lines = number("lines", 3000)
const files = number("files", 40)
const frames = number("frames", 1000)
const width = number("width", 210)
const height = number("height", 40)
const threads = number("threads", 6)

/** A file that looks enough like code that the scanner has real work to do. */
const codeOf = (count: number, seed: number): string =>
  Array.from({ length: count }, (_, index) => {
    const at = index + seed
    switch (at % 6) {
      case 0:
        return `  /** Line ${at}, and a sentence about what it is for. */`
      case 1:
        return `  export const value${at} = { id: "${at}", open: ${at % 2 === 0}, at: ${at * 7} }`
      case 2:
        return `  function handle${at}(input: string, state: State): Row[] {`
      case 3:
        return `    if (!input) return state.rows.filter((row) => row.line !== ${at})`
      case 4:
        return `    return [...state.rows, { text: \`row ${at}\`, tone: "text" }]`
      default:
        return "  }"
    }
  }).join("\n")

const changes: ChangeSet = {
  source: "branch",
  files: Array.from({ length: files }, (_, index) => {
    const long = index === 1
    const count = long ? lines : 40
    const before = codeOf(count, index * 3)
    return {
      path: `packages/review/src/core/${index === 1 ? "view/layout" : `module-${index}/thing`}.ts`,
      before,
      after: `${before}\n${codeOf(12, index * 11 + 1)}`,
      additions: 12,
      deletions: index % 3,
    }
  }),
}

const file = changes.files[1]?.path as string
let review = emptyReview()
for (let index = 0; index < threads; index++) {
  review = openThread(
    review,
    { file, line: Math.floor(((index + 1) * lines) / (threads + 1)) },
    `A note on line ${index}, long enough to wrap in a narrow pane and take more than one row of the card.`,
    "you",
    index + 1,
  )
}

/** A frame is only interesting if the state moved, so every one scrolls and walks the cursor. */
metrics.reset()
for (let frame = 0; frame < frames; frame++) {
  const scroll = frame % Math.max(1, lines - height)
  layout(
    changes,
    review,
    {
      context: 3,
      collapsed: new Set(),
      pane: "diff",
      file,
      scroll,
      line: scroll + 3,
      cursor: file,
    },
    { width, height },
  )
}

const snapshot = metrics.snapshot()
console.log(`\n  ${frames} frames · ${files} files · ${lines}-line file · ${width}x${height}\n`)
for (const line of statsLines(snapshot)) console.log(`  ${line}`)
const each = snapshot.phases.layout.mean
console.log(
  `\n  ${each.toFixed(3)}ms a frame — ${each < 1 ? "a terminal redraws in 16ms, so this is not the bottleneck" : "worth looking at: this is a visible fraction of a frame"}\n`,
)
