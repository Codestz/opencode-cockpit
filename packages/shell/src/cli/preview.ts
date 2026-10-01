#!/usr/bin/env bun

/**
 * The see-it loop: the sidebar block, the dock and the console, drawn in this terminal from sample
 * shells, with no OpenCode and no daemon running. The console and the sidebar rows are the same rows
 * OpenCode draws; only the colours come from a fixed palette (OpenCode's default theme) instead of
 * the user's, and they reach the terminal through the same tables the interface paints with.
 *
 *   bunx @opencode-cockpit/shell preview                   everything, at this terminal's width
 *   bunx @opencode-cockpit/shell preview --width 30        the sidebar at another width
 *   bunx @opencode-cockpit/shell preview --part console --state failed --columns 60
 */

import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import type { ScreenResult, ShellInfo } from "@opencode-cockpit/protocol/shell"
import { type ConsoleInput, consoleRows, type Row, type Run } from "../tui/lib/console.ts"
import { sidebarCounts, sidebarRow } from "../tui/lib/sidebar.ts"
import {
  BADGE_RULE,
  badgeText,
  displayCommand,
  kindColor,
  kindOf,
  statusDetail,
  tailRuns,
  truncate,
  watchColor,
  watchLabel,
} from "../tui/lib/view.ts"
import { fillColour, toneColour } from "../tui/view/pool.ts"
import {
  BUILD_SCREEN,
  DEV_SCREEN,
  SAMPLE_LIST,
  SAMPLE_LOG,
  SAMPLE_NOW,
  SAMPLE_PROJECT,
  SHELLS,
  TEST_SCREEN,
} from "./samples.ts"

/**
 * OpenCode's default theme, measured (docs/opencode/v2.md), as the theme object the interface reads.
 * The colour tables take a theme and hand back what is in it, so given hex strings they return hex.
 */
const THEME = {
  text: "#eeeeee",
  textMuted: "#808080",
  accent: "#9d7cd8",
  success: "#7fd88f",
  error: "#e06c75",
  warning: "#f5a742",
  border: "#484848",
  background: "#0a0a0a",
  backgroundPanel: "#141414",
  backgroundElement: "#1e1e1e",
}
const theme = THEME as unknown as TuiThemeCurrent
const hex = (colour: unknown): string => (typeof colour === "string" ? colour : THEME.text)

const rgb = (code: string) => [1, 3, 5].map((i) => Number.parseInt(code.slice(i, i + 2), 16)).join(";")
const color = process.stdout.isTTY && !process.env.NO_COLOR

function paint(row: Row): string {
  if (!color) return row.map((run) => run.text).join("")
  return row
    .map((run: Run) => {
      const fg = run.fg ?? hex(toneColour(theme, run.tone))
      const bg = run.bg ?? fillColour(theme, run)
      const codes = [`38;2;${rgb(fg)}`]
      if (bg) codes.push(`48;2;${rgb(hex(bg))}`)
      if (run.bold) codes.push("1")
      return `\x1b[${codes.join(";")}m${run.text}\x1b[0m`
    })
    .join("")
}

/** Exactly `width` cells: cut with `…`, or padded in the row's last background. */
function fitRow(row: Row, width: number): Row {
  const out: Row = []
  let used = 0
  for (const run of row) {
    if (used >= width) break
    const room = width - used
    const text = run.text.length > room ? `${run.text.slice(0, Math.max(0, room - 1))}…` : run.text
    out.push({ ...run, text })
    used += text.length
  }
  const last = out.at(-1)
  if (used < width) out.push({ text: " ".repeat(width - used), ...(last?.bg ? { bg: last.bg } : {}) })
  return out
}

// --- the sidebar ---------------------------------------------------------------------------------

function sidebar(list: readonly ShellInfo[], width: number): Row[] {
  const heading: Row = [
    { text: "Shells", bold: true },
    { text: ` ${sidebarCounts(list)}`, tone: "muted" },
  ]
  return [
    fitRow(heading, width),
    fitRow([], width),
    ...list.map((shell): Row => {
      const row = sidebarRow(shell, SAMPLE_NOW, 2, width)
      const kind = hex(kindColor(theme, kindOf(shell)))
      return [
        { text: row.rule, fg: kind },
        { text: row.label, fg: kind, bold: true },
        { text: row.title },
        { text: row.watch, fg: hex(watchColor(theme, shell)) },
        { text: row.detail, tone: "muted" },
      ]
    }),
  ]
}

// --- the dock ------------------------------------------------------------------------------------

/**
 * The dock under the conversation. `components/dock.tsx` lays it out with flexbox rather than from
 * rows, so this follows that layout with the same helpers and the same colours: the tabs, the
 * selected shell's screen, and its status line. The key hint at the right of the tab row is left
 * out; its words live with the plugin's keymap, not here.
 */
function dock(list: readonly ShellInfo[], selected: ShellInfo, screen: ScreenResult, width: number): Row[] {
  const panel = THEME.backgroundPanel
  const on = (run: Run): Run => ({ bg: panel, ...run })
  const height = 14
  const bodyRows = Math.max(2, height - 3)
  const bodyCols = Math.max(10, width - 4)
  const tabLimit = Math.max(1, Math.floor((width - 26) / 30))
  const tabs = list.slice(0, tabLimit)
  const overflow = list.length - tabs.length
  const tabRow: Row = [
    on({ text: " " }),
    on({ text: "Shells", bold: true }),
    on({ text: " this session", tone: "muted" }),
    ...tabs.flatMap((shell): Run[] => {
      const active = shell.id === selected.id
      const back = active ? THEME.backgroundElement : panel
      const kind = hex(kindColor(theme, kindOf(shell)))
      return [
        on({ text: " " }),
        { text: BADGE_RULE, fg: kind, bg: back },
        { text: badgeText(kindOf(shell), 2).slice(BADGE_RULE.length), fg: kind, bg: back, bold: true },
        {
          text: ` ${truncate(shell.title, 22)} `,
          bg: back,
          ...(active ? { bold: true } : { tone: "muted" }),
        },
      ]
    }),
    ...(overflow > 0 ? [on({ text: ` ▸ ${overflow} more`, tone: "muted" })] : []),
  ]
  const body = tailRuns(screen.styled, bodyRows, bodyCols).map(
    (runs): Row => [
      on({ text: "  " }),
      ...runs.map((run) =>
        on({ text: run.text, fg: run.fg ?? THEME.text, ...(run.bold ? { bold: true } : {}) }),
      ),
    ],
  )
  while (body.length < bodyRows) body.push([on({ text: "" })])
  const kind = kindOf(selected)
  const watch = watchLabel(selected)
  const tail = Math.max(20, width - 40)
  const status: Row = [
    on({ text: "  " }),
    on({ text: statusDetail(selected, SAMPLE_NOW), fg: hex(kindColor(theme, kind)) }),
    ...(watch ? [on({ text: ` ${watch}`, fg: hex(watchColor(theme, selected)) })] : []),
    kind === "fail" && selected.summary
      ? on({ text: ` ${truncate(selected.summary, tail)}`, tone: "error" })
      : on({ text: ` ${truncate(`$ ${displayCommand(selected)}`, tail)}`, tone: "muted" }),
  ]
  return [
    fitRow([on({ text: "─".repeat(width), tone: "border" })], width),
    fitRow(tabRow, width),
    ...body.map((row) => fitRow(row, width)),
    fitRow(status, width),
  ]
}

// --- the console ---------------------------------------------------------------------------------

type State = "empty" | "running" | "failed" | "details" | "log" | "done"

const STATES: Record<State, string> = {
  empty: "no shells in this session yet",
  running: "a dev server, its watcher failing",
  failed: "a test run that failed, with its reason",
  details: "everything known about the running shell, and the other keys",
  log: "the log, filtered to a word",
  done: "a build that finished",
}

function consoleInput(state: State, width: number): ConsoleInput {
  const shell: ShellInfo | undefined =
    state === "empty"
      ? undefined
      : state === "failed"
        ? SHELLS.failed
        : state === "done"
          ? SHELLS.done
          : SHELLS.running
  const running = shell?.status === "running"
  const view = state === "details" ? "details" : state === "log" ? "log" : "screen"
  const filter = state === "log" ? "app1" : ""
  return {
    ...(shell ? { shell } : {}),
    now: SAMPLE_NOW,
    frame: 2,
    project: SAMPLE_PROJECT,
    ...(shell
      ? { screen: shell === SHELLS.failed ? TEST_SCREEN : shell === SHELLS.done ? BUILD_SCREEN : DEV_SCREEN }
      : {}),
    log: filter ? SAMPLE_LOG.filter((line) => line.text.includes(filter)) : SAMPLE_LOG,
    view,
    up: 0,
    typing: false,
    colors: true,
    filter,
    searching: false,
    draft: "",
    keys: {
      shell: Boolean(shell),
      running,
      view,
      filtered: Boolean(filter),
      count: shell ? SAMPLE_LIST.length : 0,
      scope: "session",
      finished: 3,
    },
    position: shell ? `${SAMPLE_LIST.indexOf(shell) + 1}/${SAMPLE_LIST.length}` : "",
    width,
    height: 22,
    fill: false,
  }
}

// --- the command ---------------------------------------------------------------------------------

const args = process.argv.slice(2)
if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(
    [
      "Usage: shell preview [--part sidebar|dock|console] [--state <name>]",
      "                     [--width <sidebar columns>] [--columns <dock and console columns>]",
      "",
      "  Draws Shell's surfaces from sample shells: no OpenCode, no daemon. Plain text under",
      "  NO_COLOR or into a pipe.",
      "",
      "  --part      one surface (default: all three)",
      "  --width     the sidebar's width (default 38, about what OpenCode gives it)",
      "  --columns   the dock's and the console's width (default: this terminal, 60 to 140)",
      "  --state     the console in one state (default: every one):",
      ...Object.entries(STATES).map(([name, about]) => `                ${name.padEnd(9)}${about}`),
      "",
    ].join("\n"),
  )
  process.exit(0)
}
const option = (name: string): string | undefined => {
  const at = args.indexOf(name)
  return at >= 0 ? args[at + 1] : undefined
}
const sidebarWidth = Number(option("--width")) || 38
const columns = Number(option("--columns")) || Math.max(60, Math.min(process.stdout.columns || 100, 140))
const part = option("--part")
const state = option("--state")
if (part && !["sidebar", "dock", "console"].includes(part)) {
  process.stderr.write(`Unknown part "${part}". One of: sidebar, dock, console\n`)
  process.exit(1)
}
if (state && !(state in STATES)) {
  process.stderr.write(`Unknown state "${state}". One of: ${Object.keys(STATES).join(", ")}\n`)
  process.exit(1)
}

const out: string[] = []
const section = (title: string, rows: Row[]) => {
  out.push("", title, "")
  for (const row of rows) out.push(paint(row))
}
if (!part || part === "sidebar")
  section(`Sidebar — ${sidebarWidth} columns`, sidebar(SAMPLE_LIST, sidebarWidth))
if (!part || part === "dock")
  section(`Dock — ${columns} columns`, dock(SAMPLE_LIST, SHELLS.running, DEV_SCREEN, columns))
if (!part || part === "console")
  for (const name of Object.keys(STATES) as State[]) {
    if (state && state !== name) continue
    section(
      `Console — ${name}: ${STATES[name]}, ${columns} columns`,
      consoleRows(consoleInput(name, columns)),
    )
  }
process.stdout.write(`${out.join("\n")}\n\n`)
