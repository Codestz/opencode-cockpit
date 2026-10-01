#!/usr/bin/env bun
/**
 * The see-it loop: the sidebar block and the ledger dialog, drawn in this terminal from sample
 * worlds, with no OpenCode running. The same rows OpenCode draws — only the colours come from a fixed
 * palette (OpenCode's default theme) instead of the user's.
 *
 *   bunx @opencode-cockpit/trust preview                  every sample
 *   bunx @opencode-cockpit/trust preview --sample busy    one of them
 *   bunx @opencode-cockpit/trust preview --width 30       the sidebar at another width
 */

import { SAMPLE_NOW, SAMPLE_SETTINGS, SAMPLES } from "../core/sample.ts"
import { ledgerItems, ledgerRows, ledgerShown } from "../core/view/ledger.ts"
import type { Row, Run, Tone } from "../core/view/rows.ts"
import { sidebarRows } from "../core/view/sidebar.ts"

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
const SELECTED = "#1e1e1e"

const rgb = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).join(";")
const color = process.stdout.isTTY && !process.env.NO_COLOR

function paint(row: Row): string {
  if (!color) return row.map((run) => run.text).join("")
  return row
    .map((run: Run) => {
      const codes = [`38;2;${rgb(HEX[run.tone ?? "text"])}`]
      if (run.fill === "selected") codes.push(`48;2;${rgb(SELECTED)}`)
      if (run.bold) codes.push("1")
      if (run.faint) codes.push("2")
      return `\x1b[${codes.join(";")}m${run.text}\x1b[0m`
    })
    .join("")
}

const args = process.argv.slice(2)
if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(
    `Usage: trust preview [--sample ${Object.keys(SAMPLES).join("|")}] [--width <sidebar columns>]\n`,
  )
  process.exit(0)
}
const value = (flag: string) => {
  const at = args.indexOf(flag)
  return at >= 0 ? args[at + 1] : undefined
}
const sidebarWidth = Number(value("--width")) || 36
const columns = Math.max(60, Math.min(process.stdout.columns || 100, 116))
const only = value("--sample")
const names = only ? [only] : Object.keys(SAMPLES)

const frame = (rows: Row[]) => {
  const edge = color ? `\x1b[38;2;${rgb(HEX.border)}m│\x1b[0m` : "│"
  return rows.map((row) => `${edge}${paint(row)}${edge}`)
}

const out: string[] = []
for (const name of names) {
  const make = SAMPLES[name]
  if (!make) {
    process.stderr.write(`No sample "${name}". Try: ${Object.keys(SAMPLES).join(", ")}\n`)
    process.exit(1)
  }
  const { engine, trouble } = make()
  out.push("", `── ${name} ──`, "", "Sidebar", "")
  const sidebar = sidebarRows({
    width: sidebarWidth,
    recent: engine.recent(),
    count: engine.count(),
    pending: engine.pending(),
    state: engine.state,
    limit: 3,
    ...(trouble ? { trouble } : {}),
  })
  out.push(...(sidebar.length > 0 ? frame(sidebar) : ["(nothing: the block is silent)"]))
  out.push("", "Ledger", "")
  /** As the dialog lists them: commands approved once folded into one line. */
  const { items, folded } = ledgerShown(
    ledgerItems(engine.state, SAMPLE_SETTINGS, SAMPLE_NOW),
    SAMPLE_SETTINGS,
    SAMPLE_NOW,
    false,
  )
  const { rows } = ledgerRows({
    width: columns,
    height: Math.min(18, 7 + items.length),
    items,
    folded,
    selected: 0,
    state: engine.state,
    settings: SAMPLE_SETTINGS,
    now: SAMPLE_NOW,
  })
  out.push(...frame(rows))
}
process.stdout.write(`${out.join("\n")}\n`)
