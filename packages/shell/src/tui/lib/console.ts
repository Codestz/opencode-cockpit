/**
 * The shell console, as rows of styled runs — the one drawing of it, at any size.
 *
 * The dialog and full screen used to be two implementations, and they drifted within a day: full
 * screen had no `last output:` line, no details, no search. Now there is one builder and two hosts.
 * The dialog renders these rows in the host's dialog; full screen assigns them onto a pool of lines,
 * the way Review's panel does (a slot is drawn once — docs/opencode/gotchas.md). Only the size differs.
 * Pure on purpose: every state of the console can be checked from a test.
 */

import type { LogLine, ScreenResult, ShellInfo } from "@opencode-cockpit/protocol/shell"
import { detailRows } from "./details.ts"
import { splitMatches } from "./search.ts"
import {
  badgeText,
  type ConsoleKeysState,
  displayCommand,
  fitHints,
  footerHints,
  keyRows,
  kindOf,
  panelHints,
  relativeCwd,
  statusDetail,
  tailRuns,
  truncate,
  watchLabel,
  wrapText,
} from "./view.ts"

/** Named for meaning; each host maps them onto the theme. */
export type Tone = "text" | "muted" | "accent" | "success" | "error" | "warning" | "border" | "match"

export interface Run {
  text: string
  tone?: Tone
  /** An exact colour the program printed ("#rrggbb"); wins over `tone`. */
  fg?: string
  bg?: string
  bold?: boolean
  /** The title bar's raised surface. */
  raised?: boolean
}
export type Row = Run[]

export type View = "screen" | "log" | "details"

export interface Notice {
  text: string
  tone: "info" | "success" | "error"
}

export interface ConsoleInput {
  shell?: ShellInfo
  now: number
  /** Spinner frame, as the sidebar and dock use. */
  frame: number
  project: string
  screen?: ScreenResult
  log: readonly LogLine[]
  view: View
  /** Rows scrolled up from the bottom; 0 follows the output. */
  up: number
  typing: boolean
  /** Paint the colours programs print (config: ui.colors). */
  colors: boolean
  /** The log filter in force, and the query being typed for one. */
  filter: string
  searching: boolean
  draft: string
  notice?: Notice
  /** Everything the key row needs to know. */
  keys: ConsoleKeysState
  /** "2/3" when there is more than one shell to move between. */
  position: string
  width: number
  /** The most rows the console may take. */
  height: number
  /** Fill `height` (full screen) or shrink to what there is to show (the dialog). */
  fill: boolean
}

/** Columns of margin each side, and the body's gutter. */
const MARGIN = 2
const GUTTER = "│ "
const COMMAND_LINES = 3
/** The smallest body the dialog shrinks to, so a quiet shell does not collapse to a line. */
const MIN_BODY = 6

const KIND_TONE: Record<string, Tone> = { run: "success", fail: "error", stop: "warning", done: "muted" }

/** Pads a row out to exactly `width` cells, cutting whatever does not fit. */
function fit(runs: Row, width: number, raised = false): Row {
  const out: Row = []
  let used = 0
  for (const run of runs) {
    if (used >= width) break
    const text = run.text.slice(0, width - used)
    used += text.length
    out.push({ ...run, text, ...(raised ? { raised: true } : {}) })
  }
  if (used < width) out.push({ text: " ".repeat(width - used), ...(raised ? { raised: true } : {}) })
  return out
}

const pad = " ".repeat(MARGIN)
/** Content width inside the margins. */
export const innerCols = (width: number) => Math.max(10, width - MARGIN * 2)
/** What the program's screen gets: the inside, less the gutter. */
export const screenCols = (width: number) => Math.max(8, innerCols(width) - GUTTER.length)

/** Everything above the body, so hosts can size the program to what is shown. */
function headRows(input: ConsoleInput): Row[] {
  const { shell, width } = input
  const cols = innerCols(width)
  if (!shell) return []
  const kind = kindOf(shell)
  const tone = KIND_TONE[kind]
  const status = [statusDetail(shell, input.now), shell.run > 1 ? `run ${shell.run}` : "", input.position]
    .filter(Boolean)
    .join(" · ")
  const watch = watchLabel(shell)
  const badge = `${badgeText(kind, input.frame)}  `
  const right = `${watch ? `${watch}   ` : ""}${status}`
  const title = truncate(shell.title, Math.max(4, cols - badge.length - right.length - 1))
  const rows: Row[] = [
    fit(
      [
        { text: pad },
        { text: badge, tone, bold: true },
        { text: title, bold: true },
        { text: " ".repeat(Math.max(1, cols - badge.length - title.length - right.length)) },
        ...(watch ? [{ text: `${watch}   `, tone: "accent" as const }] : []),
        { text: status, tone: "muted" },
      ],
      width,
      true,
    ),
  ]
  wrapText(displayCommand(shell), cols - 2, COMMAND_LINES).forEach((line, index) => {
    rows.push(fit([{ text: pad }, { text: index === 0 ? "$ " : "  ", tone: "muted" }, { text: line }], width))
  })
  const folder = relativeCwd(shell.cwd, input.project)
  if (folder) rows.push(fit([{ text: pad }, { text: truncate(`in ${folder}`, cols), tone: "muted" }], width))
  if (shell.summary && (kind === "fail" || kind === "stop")) {
    const said = `${kind === "fail" ? "error" : "last output"}: ${shell.summary}`
    rows.push(fit([{ text: pad }, { text: truncate(said, cols), tone }], width))
  }
  return rows
}

/** The body's lines, before any are cut to fit. */
function bodyLines(input: ConsoleInput, room: number): Row[] {
  const { shell, width } = input
  const cols = screenCols(width)
  if (!shell) return []
  if (input.view === "details") {
    const rows = [...detailRows(shell, input.now, cols), ...keyRows(panelHints(input.keys), cols)]
    return rows.map(([key, value]) => [{ text: key.padEnd(10), tone: "muted" }, { text: value }])
  }
  if (input.view === "log") {
    const end = Math.max(0, input.log.length - input.up)
    const lines = input.log.slice(Math.max(0, end - room), end)
    if (input.filter && lines.length === 0)
      return [[{ text: `no lines match "${input.filter}"`, tone: "muted" }]]
    return lines.map((line) => [
      { text: `${String(line.n).padStart(5)} `, tone: "muted" },
      ...splitMatches(truncate(line.text, cols - 6), input.filter).map((part) =>
        part.match ? { text: part.text, tone: "match" as const } : { text: part.text },
      ),
    ])
  }
  if (input.colors && input.screen?.styled) {
    return tailRuns(input.screen.styled, room, cols, input.up).map((runs) =>
      runs.map((run) => ({
        text: run.text,
        ...(run.fg ? { fg: run.fg } : {}),
        ...(run.bg ? { bg: run.bg } : {}),
        ...(run.bold ? { bold: true } : {}),
      })),
    )
  }
  const all = input.screen?.text ? input.screen.text.split("\n") : []
  const end = Math.max(0, all.length - input.up)
  return all.slice(Math.max(0, end - room), end).map((line) => [{ text: truncate(line, cols) }])
}

/** The row under the body: a notice, a mode and how to leave it, or the keys that act right now. */
function footer(input: ConsoleInput): Row {
  const cols = innerCols(input.width)
  const said = (text: string, tone: Tone): Row => [{ text: pad }, { text: truncate(text, cols), tone }]
  if (input.notice)
    return said(
      input.notice.text,
      input.notice.tone === "error" ? "error" : input.notice.tone === "success" ? "success" : "warning",
    )
  if (input.searching) return said(`search: ${input.draft}▏· enter filters · esc cancels`, "accent")
  if (input.typing)
    return said("TYPING: keys go to the shell (ctrl+c included) · ctrl+] stop typing", "accent")
  if (input.up > 0 && input.view !== "details")
    return said(`↑ ${input.up} rows up · j/k scroll · G follows the output`, "accent")
  const fitted = fitHints(footerHints(input.keys), cols)
  return [
    { text: pad },
    ...fitted.hints.flatMap((hint): Run[] => [
      { text: `[${hint.key}]`, tone: "accent", bold: true },
      { text: `${hint.labelled ? ` ${hint.label}` : ""}   `, tone: "muted" },
    ]),
    ...(fitted.dropped > 0 ? [{ text: "…", tone: "muted" as const }] : []),
  ]
}

/** How many body rows the console shows for this input — what a typing program is sized to. */
/**
 * The rows the body has room for, however much output there is — what a program is sized to. The
 * body as drawn shrinks to its output in the dialog; sized to that, a program was resized every time
 * it printed a line.
 */
export function bodyRoom(input: ConsoleInput): number {
  /** The head, a gap, the body, a gap, the key row: exactly `height` when filling. */
  return Math.max(3, input.height - headRows(input).length - 3)
}

export function bodyHeight(input: ConsoleInput): number {
  const room = bodyRoom(input)
  if (input.fill || input.typing) return room
  return Math.min(room, Math.max(MIN_BODY, bodyLines(input, room).length))
}

export function consoleRows(input: ConsoleInput): Row[] {
  const { width } = input
  if (!input.shell) {
    const empty = [
      fit([{ text: pad }, { text: "No shells in this project", bold: true }], width, true),
      fit(
        [
          { text: pad },
          { text: "Press n to start one. The agent starts its own with shell_start.", tone: "muted" },
        ],
        width,
      ),
    ]
    while (input.fill && empty.length < input.height - 1) empty.push(fit([], width))
    return [...empty, fit(footer(input), width)]
  }
  const head = headRows(input)
  const room = bodyHeight(input)
  const gutter: Run = { text: `${pad}${GUTTER}`, tone: input.typing ? "accent" : "border" }
  const body = bodyLines(input, room)
    .slice(-room)
    .map((row) => fit([gutter, ...row], width))
  /** Output starts at the top of the body, as in a terminal; a shorter one leaves room below. */
  const blank = fit([gutter], width)
  const padded = [...body, ...Array<Row>(Math.max(0, room - body.length)).fill(blank)]
  input.view === "details"
    ? [...body, ...Array(room - body.length).fill(blank)]
    : [...Array(Math.max(0, room - body.length)).fill(blank), ...body]
  return [...head, fit([], width), ...padded, fit([], width), fit(footer(input), width)]
}
