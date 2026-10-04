#!/usr/bin/env bun
/**
 * The see-it loop: the sidebar block and `/trail`, drawn in this terminal from sample trails with no
 * OpenCode running — and what the agent reads (`trail_list`, the per-request lines, the markdown
 * copy). The same rows OpenCode draws; only the colours come from a fixed palette (OpenCode's
 * default theme) instead of the user's.
 *
 *   bunx @opencode-cockpit/trail preview                  every sample
 *   bunx @opencode-cockpit/trail preview --sample busy    one of them
 *   bunx @opencode-cockpit/trail preview --width 30       the sidebar at another width
 *   bunx @opencode-cockpit/trail preview --columns 80     the dialog at another width
 *   bunx @opencode-cockpit/trail preview --rows 14        the dialog in a short window
 *   bunx @opencode-cockpit/trail preview --text           what the agent reads, too
 *   bunx @opencode-cockpit/trail preview --html > a.html  the same, as a page
 */

import { arrange, conversationThings, notRecorded, projectThings } from "../core/model.ts"
import { SAMPLE_NOW, SAMPLE_PROJECT, SAMPLES } from "../core/sample.ts"
import { listText, markdownOf, producedLine, seenLine } from "../core/text.ts"
import { dialogRows, type Tab } from "../core/view/dialog.ts"
import { type Fill, type Row, type Run, TINTS, type Tone } from "../core/view/rows.ts"
import { sidebarRows } from "../core/view/sidebar.ts"

/** OpenCode's default theme, measured (docs/opencode/v2.md). The dialog is drawn on the panel colour. */
const HEX: { [T in Exclude<Tone, "ink">]: string } = {
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
const mix = (tone: string, amount: number) => {
  const a = channels(tone)
  const b = channels(PANEL)
  return toHex(a.map((value, i) => (b[i] as number) + (value - (b[i] as number)) * amount))
}
const tint = (name: keyof typeof TINTS) => mix(HEX[TINTS[name].tone as keyof typeof HEX], TINTS[name].amount)
const FILL: { [F in Exclude<Fill, "none">]: string } = {
  selected: ELEMENT,
  panel: ELEMENT,
  button: ELEMENT,
  buttonOn: HEX.accent,
  chip: tint("chip"),
  ok: tint("ok"),
  warn: tint("warn"),
  err: tint("err"),
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
    `Usage: trail preview [--sample ${Object.keys(SAMPLES).join("|")}] [--width <sidebar columns>] [--columns <dialog columns>] [--rows <dialog rows>] [--widths 24,30,36,50] [--text] [--html]\n`,
  )
  process.exit(0)
}
const value = (flag: string) => {
  const at = args.indexOf(flag)
  return at >= 0 ? args[at + 1] : undefined
}
const sidebarWidth = Number(value("--width")) || 42
const columns = Number(value("--columns")) || Math.max(60, Math.min(process.stdout.columns || 100, 116))
const height = Number(value("--rows")) || 20
const only = value("--sample")
const text = args.includes("--text")
const names = only ? [only] : Object.keys(SAMPLES)

const frame = (rows: Row[]) => {
  const edge = html
    ? `<span style="color:${HEX.border}">│</span>`
    : color
      ? `\x1b[38;2;${rgb(HEX.border)}m│\x1b[0m`
      : "│"
  return rows.map((row) => `${edge}${paint(row)}${edge}`)
}

const NOTICE = 'settings: "trail.sidebarRows" should be a number; the default is used'

const out: string[] = []
/** `--widths 24,30,36,50`: the sidebar at each of these widths, and nothing else. */
const widths = (value("--widths") ?? "").split(",").map(Number).filter(Boolean)
for (const name of names) {
  const make = SAMPLES[name]
  if (!make) {
    process.stderr.write(`No sample "${name}". Try: ${Object.keys(SAMPLES).join(", ")}\n`)
    process.exit(1)
  }
  if (widths.length > 0) {
    const { state, session } = make()
    const mine = arrange(conversationThings(state, session))
    out.push("", `── ${name} ──`)
    for (const width of widths) {
      out.push("", `Sidebar (${width} columns)`, "")
      out.push(...frame(sidebarRows({ width, arranged: mine, now: SAMPLE_NOW, limit: 12 }).rows))
    }
    continue
  }
  const { state, session, found } = make()
  out.push("", `── ${name} ──`)
  const mine = arrange(conversationThings(state, session))
  out.push("", `Sidebar (${sidebarWidth} columns)`, "")
  out.push(...frame(sidebarRows({ width: sidebarWidth, arranged: mine, now: SAMPLE_NOW, limit: 6 }).rows))
  /** A settings notice, at a narrow sidebar's width: it wraps rather than losing the fix it names. */
  if (name === "empty" || name === "one") {
    out.push(
      "",
      `Sidebar with a settings notice (30 columns${name === "empty" ? ", and hideWhenEmpty" : ""})`,
      "",
    )
    out.push(
      ...frame(
        sidebarRows({
          width: 30,
          arranged: mine,
          now: SAMPLE_NOW,
          limit: 6,
          hideWhenEmpty: name === "empty",
          notices: [NOTICE],
        }).rows,
      ),
    )
  }

  const dialog = (
    title: string,
    tab: Tab,
    extra: { selected?: string; query?: string; searching?: boolean } = {},
  ) => {
    const view = dialogRows({
      width: columns,
      height,
      tab,
      state,
      session,
      found,
      now: SAMPLE_NOW,
      project: SAMPLE_PROJECT,
      ...extra,
    })
    out.push("", title, "")
    out.push(...frame(view.rows))
    return view
  }
  const first = dialog("/trail — This conversation", "this")
  const remaining = first.items.find((item) => item.kind === "found")
  if (remaining) dialog("/trail — on a find", "this", { selected: remaining.key })
  dialog("/trail — All conversations", "all")
  if (mine.total > 1) dialog("/trail — searching", "this", { query: "github", searching: true })

  if (text) {
    out.push("", "trail_list", "")
    out.push(listText({ state, session, all: false, query: "", now: SAMPLE_NOW }))
    out.push("", "trail_list all", "")
    out.push(listText({ state, session, all: true, query: "", now: SAMPLE_NOW }))
    out.push("", "Per-request lines", "")
    out.push(producedLine(state, session) ?? "(none)")
    out.push(seenLine(notRecorded(state, session, found)) ?? "(none)")
    out.push("", "Copied as markdown", "")
    out.push(markdownOf(mine) || "(empty)")
    out.push("", "All conversations, as markdown", "")
    out.push(markdownOf(arrange(projectThings(state))) || "(empty)")
  }
}
process.stdout.write(
  html
    ? `<!doctype html><meta charset="utf-8"><title>Trail preview</title><body style="margin:0;padding:16px;background:${PANEL};color:${HEX.text}"><pre style="font:14px/1.35 Menlo,monospace;margin:0">${out.map((line) => (line.includes("<span") ? line : entities(line))).join("\n")}</pre>\n`
    : `${out.join("\n")}\n`,
)
