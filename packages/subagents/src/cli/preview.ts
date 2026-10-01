#!/usr/bin/env bun

/**
 * The see-it loop: the sidebar block and the full screen, drawn in this terminal from a recorded run,
 * with no OpenCode running. The same rows OpenCode draws — only the colours come from a fixed
 * palette (OpenCode's default theme) instead of the user's.
 *
 *   bunx @opencode-cockpit/subagents preview            a sample run, mid-flight
 *   bunx @opencode-cockpit/subagents preview --width 34 the sidebar at another width
 *   bunx @opencode-cockpit/subagents preview --fixture advisor   another conversation (see --help)
 */

import type { Change } from "../core/model/changes.ts"
import { applyAll, emptyModel, subagentsOf } from "../core/model/model.ts"
import {
  ADVISOR_ROOT,
  advisorSample,
  CALLS_ROOT,
  CALLS_SERVERS,
  callsSample,
  LATE_ROOT,
  lateSample,
  SAMPLE_NOW,
  SAMPLE_ROOT,
  sample,
} from "../core/sample.ts"
import { type Row, type Run, rowText, type Tone } from "../core/view/rows.ts"
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
const FILL = { band: "#141414", block: "#1e1e1e", card: "#1e1e1e", selected: "#141414" } as const

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

/** Conversations to draw: the default mid-flight run, and the ones the sidebar's order is about. */
const FIXTURES: Record<string, { changes: () => Change[]; root: string; about: string }> = {
  sample: { changes: sample, root: SAMPLE_ROOT, about: "three subagents mid-flight (the default)" },
  advisor: { changes: advisorSample, root: ADVISOR_ROOT, about: "a planner asking an advisor six times" },
  late: { changes: lateSample, root: LATE_ROOT, about: "a late runner after finished ones" },
}

const args = process.argv.slice(2)
if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(
    [
      "Usage: subagents preview [--width <sidebar columns>] [--fixture <name>] [--columns <pane columns>]",
      "                         [--state closed|open|whole]",
      "",
      ...Object.entries(FIXTURES).map(([name, { about }]) => `  ${name.padEnd(10)}${about}`),
      "  calls     a call of every kind: thinking as markdown, todos, an MCP tool, a task,",
      "            and an ask_advisor with a sixty-line question — folded, open and whole",
      "",
      "  --state   with --fixture calls, only that state",
      "",
    ].join("\n"),
  )
  process.exit(0)
}
const option = (name: string): string | undefined => {
  const at = args.indexOf(name)
  return at >= 0 ? args[at + 1] : undefined
}
const sidebarWidth = Number(option("--width")) || 36
const columns = Number(option("--columns")) || Math.max(60, Math.min(process.stdout.columns || 100, 140))

if (option("--fixture") === "calls") {
  const model = applyAll(emptyModel(), callsSample())
  const nodes = subagentsOf(model, CALLS_ROOT)
  const session = nodes[0]?.session
  if (!session) throw new Error("the calls fixture has no subagent")
  const base = {
    session,
    nodes,
    launcher: "build",
    width: columns,
    height: 400,
    now: SAMPLE_NOW,
    frame: 2,
    top: 0,
    open: new Set<string>(),
    closed: new Set<string>(),
    thinking: false,
    details: false,
    servers: CALLS_SERVERS,
  }
  const keys = screenRows(base).keys
  const calls = keys.filter((key) => key.startsWith("tool:"))
  const states = {
    closed: base,
    open: { ...base, open: new Set(keys) },
    whole: { ...base, open: new Set(keys), whole: new Set(calls) },
  }
  const out: string[] = []
  for (const [name, input] of Object.entries(states)) {
    if (option("--state") && option("--state") !== name) continue
    out.push("", `Every kind of call — ${name}, ${columns} columns`, "")
    const screen = screenRows(input)
    /** The body only, without the rows of nothing the tall pane pads it with. */
    const body = screen.rows.slice(screen.bodyAt, -3)
    while (body.length > 0 && rowText(body.at(-1) ?? []).trim() === "") body.pop()
    for (const row of body) out.push(paint(row))
  }
  process.stdout.write(`${out.join("\n")}\n\n`)
  process.exit(0)
}

const fixture = FIXTURES[option("--fixture") ?? "sample"]
if (!fixture) {
  process.stderr.write(`Unknown fixture. One of: ${[...Object.keys(FIXTURES), "calls"].join(", ")}\n`)
  process.exit(1)
}

const model = applyAll(emptyModel(), fixture.changes())
const nodes = subagentsOf(model, fixture.root)
const out: string[] = ["", "Sidebar", ""]
/** The host's default for nested ones: thirty seconds. */
for (const line of sidebarLines({ nodes, width: sidebarWidth, now: SAMPLE_NOW, frame: 2, fadeAfter: 30_000 }))
  out.push(paint(line.row))
const first = nodes[0]?.session
if (first) {
  const base = {
    session: first,
    nodes,
    launcher: "build",
    width: columns,
    height: 30,
    now: SAMPLE_NOW,
    frame: 2,
    open: new Set<string>(),
    closed: new Set<string>(),
    thinking: false,
    details: false,
  }
  out.push("", "The pane — the first subagent", "")
  const folded = screenRows(base)
  for (const row of folded.rows) out.push(paint(row))
  /** The same, with the cursor on the first call and that call open. */
  const call = folded.keys.find((key) => key.startsWith("tool:"))
  if (call) {
    out.push("", "A call, selected and open", "")
    const opened = screenRows({ ...base, selected: call, open: new Set([call]), top: 0 })
    for (const row of opened.rows) out.push(paint(row))
  }
  out.push("", "Details", "")
  for (const row of screenRows({ ...base, details: true, height: 20 }).rows) out.push(paint(row))
}
process.stdout.write(`${out.join("\n")}\n\n`)
