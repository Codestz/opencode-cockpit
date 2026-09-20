#!/usr/bin/env bun
/**
 * Draw the review here, against sample change sets, with no OpenCode running.
 *
 *   bun packages/review/src/cli/preview.ts
 *   bun packages/review/src/cli/preview.ts --fixture sprawl --width 210 --height 40
 *
 * This is where the design is made. Editing TypeScript, restarting OpenCode and judging the result
 * from a sentence cost the statusline about twenty restarts, three of them on glyph choices that read
 * completely differently on screen than they do in prose.
 */

import { FIXTURES, type FixtureName } from "../core/fixtures.ts"
import { emptyReview, toggleRead } from "../core/model/review.ts"
import { type Fill, layout, type Row, type Tone } from "../core/view/layout.ts"

const args = process.argv.slice(2).filter((arg) => arg !== "preview")
const flag = (name: string): string | undefined => {
  const at = args.indexOf(`--${name}`)
  return at === -1 ? undefined : args[at + 1]
}

if (args.includes("--help")) {
  console.log(`
  preview — draw the review here, against sample change sets

    --fixture <name>  ${Object.keys(FIXTURES).join(" | ")} (default: turn)
    --file <path>     which file to show the diff of (default: the second one)
    --width <n>       columns (default: this terminal)
    --height <n>      rows (default: this terminal)
`)
  process.exit(0)
}

const ESC = String.fromCharCode(27)
const RESET = `${ESC}[0m`
const BOLD = `${ESC}[1m`

/** OpenCode's own dark theme, near enough to judge colour by. The pane reads the real thing. */
const FG: Record<Tone, string> = {
  text: `${ESC}[38;2;205;214;244m`,
  muted: `${ESC}[38;2;127;132;156m`,
  accent: `${ESC}[38;2;137;180;250m`,
  border: `${ESC}[38;2;69;71;90m`,
  added: `${ESC}[38;2;166;227;161m`,
  removed: `${ESC}[38;2;243;139;168m`,
  hunk: `${ESC}[38;2;137;180;250m`,
  lineNumber: `${ESC}[38;2;108;112;134m`,
  success: `${ESC}[38;2;166;227;161m`,
  warning: `${ESC}[38;2;249;226;175m`,
  keyword: `${ESC}[38;2;203;166;247m`,
  string: `${ESC}[38;2;166;227;161m`,
  number: `${ESC}[38;2;250;179;135m`,
  comment: `${ESC}[38;2;108;112;134m`,
  type: `${ESC}[38;2;249;226;175m`,
  function: `${ESC}[38;2;137;180;250m`,
  variable: `${ESC}[38;2;205;214;244m`,
  operator: `${ESC}[38;2;137;220;235m`,
  punct: `${ESC}[38;2;147;153;178m`,
}

const BG: Record<Fill, string> = {
  none: "",
  added: `${ESC}[48;2;27;46;36m`,
  removed: `${ESC}[48;2;56;29;38m`,
  selected: `${ESC}[48;2;49;50;68m`,
  panel: `${ESC}[48;2;30;30;46m`,
}

const paint = (row: Row): string =>
  row.runs
    .map(
      (run) => `${BG[run.fill ?? "none"]}${FG[run.tone ?? "text"]}${run.bold ? BOLD : ""}${run.text}${RESET}`,
    )
    .join("")

const width = Number(flag("width") ?? process.stdout.columns ?? 120)
const height = Number(flag("height") ?? process.stdout.rows ?? 40)

const name = (flag("fixture") ?? "turn") as FixtureName
const fixture = FIXTURES[name]
if (!fixture) {
  console.error(`no such fixture: ${name}. try ${Object.keys(FIXTURES).join(", ")}`)
  process.exit(1)
}

const changes = fixture.changes
/** A review part-way through: one file read, so the marks and the progress are not all one state. */
const review = changes.files[0] ? toggleRead(emptyReview(), changes.files[0].path) : emptyReview()
const file = flag("file") ?? changes.files[1]?.path ?? changes.files[0]?.path

const rows = layout(changes, review, { file, cursor: file, context: 3 }, { width, height })

console.log(`\n${BOLD}${name}${RESET} — ${fixture.about}  ${FG.muted}${width}×${height}${RESET}`)
console.log(`${FG.border}┌${"─".repeat(width - 2)}┐${RESET}`)
for (const row of rows) {
  const used = row.runs.reduce((sum, run) => sum + run.text.length, 0)
  console.log(
    `${FG.border}│${RESET}${paint(row)}${" ".repeat(Math.max(0, width - 2 - used))}${FG.border}│${RESET}`,
  )
}
console.log(`${FG.border}└${"─".repeat(width - 2)}┘${RESET}`)
