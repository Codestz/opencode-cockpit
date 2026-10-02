#!/usr/bin/env bun
/**
 * The see-it loop: the sidebar block and both Trust screens — the activity `/trust` opens on and the
 * ledger behind `l` — drawn in this terminal from sample worlds, with no OpenCode running. The same
 * rows OpenCode draws; only the colours come from a fixed palette (OpenCode's default theme) instead
 * of the user's.
 *
 *   bunx @opencode-cockpit/trust preview                    every sample, both screens
 *   bunx @opencode-cockpit/trust preview --sample busy      one of them
 *   bunx @opencode-cockpit/trust preview --view activity    only the screen /trust opens on
 *   bunx @opencode-cockpit/trust preview --view ledger      only the ledger (the explorer and its card)
 *   bunx @opencode-cockpit/trust preview --columns 80       the dialog at another width
 *   bunx @opencode-cockpit/trust preview --rows 20          the dialog in a short window
 *   bunx @opencode-cockpit/trust preview --width 30         the sidebar at another width
 *   bunx @opencode-cockpit/trust preview --keys             the key lists (`?`) too
 *   bunx @opencode-cockpit/trust preview --html > a.html    the same, as a page, to judge colour in a browser
 *
 * The ledger is drawn more than once a sample: as it opens, then with the cursor on a trusted command
 * in its open family, on a family you widened, on one still counting, on a dangerous command, on
 * OpenCode's own "always", and with `tab` into the card's buttons.
 */

import { SAMPLE_NOW, SAMPLE_ROOT, SAMPLE_SETTINGS, SAMPLES } from "../core/sample.ts"
import { activityRows } from "../core/view/activity.ts"
import { explorerModel, explorerRows, type Node, reveal } from "../core/view/explorer.ts"
import { type Fill, type Row, type Run, TINTS, type Tone } from "../core/view/rows.ts"
import { sidebarRows } from "../core/view/sidebar.ts"

/** OpenCode's default theme, measured (docs/opencode/v2.md). The dialog is drawn on the panel colour. */
const HEX: Record<Exclude<Tone, "ink">, string> = {
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
const PANEL = "#141414"
const ELEMENT = "#1e1e1e"

const channels = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16))
const toHex = (values: number[]) =>
  `#${values.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`
/** A tint as `tui/render.ts` mixes it: the tone faded into the panel colour. */
const mix = (tone: string, amount: number) => {
  const a = channels(tone)
  const b = channels(PANEL)
  return toHex(a.map((value, i) => (b[i] as number) + (value - (b[i] as number)) * amount))
}
const FILL: Record<Exclude<Fill, "none">, string> = {
  selected: ELEMENT,
  panel: ELEMENT,
  button: ELEMENT,
  buttonOn: HEX.accent,
  chip: mix(HEX[TINTS.chip.tone as keyof typeof HEX], TINTS.chip.amount),
  ok: mix(HEX[TINTS.ok.tone as keyof typeof HEX], TINTS.ok.amount),
  warn: mix(HEX[TINTS.warn.tone as keyof typeof HEX], TINTS.warn.amount),
  err: mix(HEX[TINTS.err.tone as keyof typeof HEX], TINTS.err.amount),
}
const ink = (tone: Tone | undefined) => (tone === "ink" ? PANEL : HEX[tone ?? "text"])

const rgb = (hex: string) => channels(hex).join(";")
const args = process.argv.slice(2)
const html = args.includes("--html")
const color = html || (process.stdout.isTTY && !process.env.NO_COLOR)
const entities = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

function paint(row: Row): string {
  if (!color) return row.map((run) => run.text).join("")
  if (html)
    return row
      .map((run: Run) => {
        const style = [`color:${ink(run.tone)}`]
        if (run.fill && run.fill !== "none") style.push(`background:${FILL[run.fill]}`)
        if (run.bold) style.push("font-weight:bold")
        if (run.faint) style.push("opacity:.55")
        return `<span style="${style.join(";")}">${entities(run.text)}</span>`
      })
      .join("")
  return row
    .map((run: Run) => {
      const codes = [`38;2;${rgb(ink(run.tone))}`]
      if (run.fill && run.fill !== "none") codes.push(`48;2;${rgb(FILL[run.fill])}`)
      if (run.bold) codes.push("1")
      if (run.faint) codes.push("2")
      return `\x1b[${codes.join(";")}m${run.text}\x1b[0m`
    })
    .join("")
}

if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(
    `Usage: trust preview [--sample ${Object.keys(SAMPLES).join("|")}] [--view activity|ledger] [--columns <dialog columns>] [--rows <dialog rows>] [--width <sidebar columns>] [--keys] [--html]\n`,
  )
  process.exit(0)
}
const value = (flag: string) => {
  const at = args.indexOf(flag)
  return at >= 0 ? args[at + 1] : undefined
}
const sidebarWidth = Number(value("--width")) || 36
const columns = Number(value("--columns")) || Math.max(60, Math.min(process.stdout.columns || 100, 116))
const fixedRows = Number(value("--rows")) || undefined
const only = value("--sample")
const view = value("--view")
if (view !== undefined && view !== "activity" && view !== "ledger") {
  process.stderr.write(`No view "${view}". Try: activity, ledger\n`)
  process.exit(1)
}
const keys = args.includes("--keys")
const names = only ? [only] : Object.keys(SAMPLES)
/** The folder name the header shows: the sample project's. */
const project = SAMPLE_ROOT.split("/").at(-1) ?? ""

const frame = (rows: Row[]) => {
  const edge = html
    ? `<span style="color:${HEX.border}">│</span>`
    : color
      ? `\x1b[38;2;${rgb(HEX.border)}m│\x1b[0m`
      : "│"
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
  out.push("", `── ${name} ──`)
  if (view === undefined) {
    out.push("", "Sidebar", "")
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
  }
  const reading = { state: engine.state, settings: SAMPLE_SETTINGS, now: SAMPLE_NOW, history: engine.history }
  const height = fixedRows ?? 24

  if (view !== "ledger") {
    const drawActivity = (title: string, pick?: (keys: string[]) => string | undefined, withKeys = false) => {
      const first = activityRows({ ...reading, width: columns, height, project })
      const selected = pick?.(first.model.items.map((item) => item.key))
      const { rows } = activityRows({
        ...reading,
        width: columns,
        height,
        project,
        ...(selected !== undefined ? { selected } : {}),
        ...(withKeys ? { keys: true } : {}),
      })
      out.push("", title, "")
      out.push(...frame(rows))
    }
    drawActivity("Activity — as /trust opens")
    if (keys) drawActivity("Activity — ? keys", undefined, true)
  }

  if (view !== "activity") {
    const open = new Set<string>()
    const full = new Set<string>()
    const tree = { open, full, filter: "" }
    const families = explorerModel({ ...reading, ...tree }).families
    const drawLedger = (
      title: string,
      pick: (nodes: readonly Node[]) => Node | undefined,
      extra: { focus?: { button: number }; keys?: boolean; typing?: string; filter?: string } = {},
    ) => {
      const filter = extra.filter ?? ""
      const model = explorerModel({ ...reading, open, full, filter })
      const selected = pick(model.nodes)?.key
      const { rows } = explorerRows({
        ...reading,
        open,
        full,
        filter,
        width: columns,
        height,
        project,
        ...(selected !== undefined ? { selected } : {}),
        ...(extra.focus ? { focus: extra.focus } : {}),
        ...(extra.keys ? { keys: true } : {}),
        ...(extra.typing !== undefined ? { typing: extra.typing } : {}),
      })
      out.push("", title, "")
      out.push(...frame(rows))
    }
    drawLedger("Ledger — as l opens it", (nodes) => nodes[0])
    /** A trusted command in a family of several, revealed the way `enter` on the activity does. */
    const trusted = families
      .flatMap((family) => (family.commands.length > 1 ? family.commands : []))
      .find((command) => command.phase === "answering")
    if (trusted) {
      const key = reveal(tree, families, trusted)
      drawLedger("Ledger — a trusted command, its family open", (nodes) =>
        nodes.find((node) => node.key === key),
      )
    }
    const widened = families.find((family) => family.widened.length > 0)
    if (widened)
      drawLedger(
        "Ledger — a family you widened",
        (nodes) =>
          nodes.find((node) => node.kind === "family" && node.family === widened) ??
          nodes.find((node) => node.kind === "family" && node.family.key === widened.key),
      )
    const counting = families
      .flatMap((family) => family.commands)
      .find((command) => command.phase === "learning" && !command.danger)
    if (counting) {
      const key = reveal(tree, families, counting)
      drawLedger("Ledger — a command still learning", (nodes) => nodes.find((node) => node.key === key))
    }
    const danger = families
      .flatMap((family) => family.commands)
      .find((command) => command.danger && command.phase !== "answering")
    if (danger) {
      const key = reveal(tree, families, danger)
      drawLedger("Ledger — a dangerous command", (nodes) => nodes.find((node) => node.key === key))
    }
    if (engine.state.always.length > 0)
      drawLedger("Ledger — OpenCode's own always", (nodes) => nodes.find((node) => node.kind === "always"))
    if (trusted) {
      const key = reveal(tree, families, trusted)
      drawLedger("Ledger — tab into the card", (nodes) => nodes.find((node) => node.key === key), {
        focus: { button: 1 },
      })
    }
    if (keys) drawLedger("Ledger — ? keys", (nodes) => nodes[0], { keys: true })
  }
}
process.stdout.write(
  html
    ? `<!doctype html><meta charset="utf-8"><title>Trust preview</title><body style="margin:0;padding:16px;background:${PANEL};color:${HEX.text}"><pre style="font:14px/1.35 Menlo,monospace;margin:0">${out.map((line) => (line.includes("<span") ? line : entities(line))).join("\n")}</pre>\n`
    : `${out.join("\n")}\n`,
)
