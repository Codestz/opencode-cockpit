#!/usr/bin/env bun
/**
 * The see-it loop: the sidebar block and the full screen, drawn in this terminal from a recorded run,
 * with no OpenCode running. The same rows OpenCode draws — only the colours come from a fixed
 * palette (OpenCode's default theme) instead of the user's.
 *
 *   bunx @opencode-cockpit/subagents preview            a sample run, mid-flight
 *   bunx @opencode-cockpit/subagents preview --width 34 the sidebar at another width
 */

import { applyAll, emptyModel, subagentsOf } from "../core/model/model.ts"
import { SAMPLE_NOW, SAMPLE_ROOT, sample } from "../core/sample.ts"
import type { Row, Run, Tone } from "../core/view/rows.ts"
import { screenRows } from "../core/view/screen.ts"
import { sidebarLines } from "../core/view/sidebar.ts"

/** OpenCode's default theme, measured (docs/opencode/v2.md). */
const HEX: Record<Tone, string> = {
  text: "#eeeeee",
  muted: "#808080",
  accent: "#9d7cd8",
  info: "#56b6c2",
  tool: "#fab283",
  success: "#7fd88f",
  error: "#e06c75",
  warning: "#f5a742",
  border: "#484848",
}
const FILL = { band: "#141414", block: "#1e1e1e" } as const

const rgb = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).join(";")
const color = process.stdout.isTTY && !process.env.NO_COLOR

function paint(row: Row): string {
  if (!color) return row.map((run) => run.text).join("")
  return row
    .map((run: Run) => {
      const codes = [`38;2;${rgb(HEX[run.tone ?? "text"])}`]
      if (run.fill && run.fill !== "none") codes.push(`48;2;${rgb(FILL[run.fill])}`)
      if (run.bold) codes.push("1")
      if (run.faint) codes.push("2")
      return `\x1b[${codes.join(";")}m${run.text}\x1b[0m`
    })
    .join("")
}

const args = process.argv.slice(2)
if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write("Usage: subagents preview [--width <sidebar columns>]\n")
  process.exit(0)
}
const at = args.indexOf("--width")
const sidebarWidth = at >= 0 ? Number(args[at + 1]) || 36 : 36
const columns = Math.max(60, Math.min(process.stdout.columns || 100, 140))

const model = applyAll(emptyModel(), sample())
const nodes = subagentsOf(model, SAMPLE_ROOT)
const out: string[] = ["", "Sidebar", ""]
for (const line of sidebarLines({ nodes, width: sidebarWidth, now: SAMPLE_NOW, frame: 2 }))
  out.push(paint(line.row))
const first = nodes[0]?.session
if (first) {
  out.push("", "Full screen — the first subagent", "")
  const { rows } = screenRows({
    session: first,
    nodes,
    launcher: "build",
    width: columns,
    height: 28,
    now: SAMPLE_NOW,
    frame: 2,
    up: 0,
    thinking: true,
    expanded: false,
  })
  for (const row of rows) out.push(paint(row))
}
process.stdout.write(`${out.join("\n")}\n\n`)
