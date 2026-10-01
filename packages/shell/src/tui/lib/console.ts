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
/** A failure's reason gets the room the command gets: which test failed is why the console was opened. */
const REASON_LINES = 3
/** The smallest body the dialog shrinks to, so a quiet shell does not collapse to a line. */
const MIN_BODY = 6

const KIND_TONE: Record<string, Tone> = { run: "success", fail: "error", stop: "warning", done: "muted" }

/**
 * Pads a row out to exactly `width` cells, cutting whatever does not fit.
 *
 * A cut that drops words ends in `…`, so a clipped row never pretends to be whole: the empty
 * console's hint used to stop at `shell_` with nothing to say there was more. A cut that drops only
 * padding is not one anyone reads, so it gets none.
 */
function fit(runs: Row, width: number, raised = false): Row {
  const out: Row = []
  let used = 0
  const after = (index: number) =>
    runs
      .slice(index + 1)
      .map((run) => run.text)
      .join("")
  for (const [index, run] of runs.entries()) {
    if (used >= width) break
    const room = width - used
    const cut = run.text.length > room && `${run.text.slice(room)}${after(index)}`.trim().length > 0
    const text = cut ? `${run.text.slice(0, room - 1)}…` : run.text.slice(0, room)
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
  /**
   * The command, unless the title already said it. A shell started without a description is titled
   * with its command, and the row under it repeated the same words; it stays when the title had to be
   * cut, because then this row is the one place the whole command is.
   */
  const command = displayCommand(shell)
  if (title.trim() !== command.trim()) {
    wrapText(command, cols - 2, COMMAND_LINES).forEach((line, index) => {
      rows.push(
        fit([{ text: pad }, { text: index === 0 ? "$ " : "  ", tone: "muted" }, { text: line }], width),
      )
    })
  }
  const folder = relativeCwd(shell.cwd, input.project)
  if (folder) rows.push(fit([{ text: pad }, { text: truncate(`in ${folder}`, cols), tone: "muted" }], width))
  if (shell.summary && (kind === "fail" || kind === "stop")) {
    const label = kind === "fail" ? "error: " : "last output: "
    /** Wrapped under its own words rather than under the label, so the reason reads as one column. */
    wrapText(shell.summary, cols - label.length, REASON_LINES).forEach((line, index) => {
      rows.push(
        fit(
          [
            { text: pad },
            { text: index === 0 ? label : " ".repeat(label.length), tone },
            { text: index === 0 ? line : line.trimStart(), tone },
          ],
          width,
        ),
      )
    })
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

/**
 * What a details panel too short for itself says on its last row. Details do not scroll, so the way
 * to the rest is the room full screen gives — offered only where there is more room to go to.
 */
const moreRow = (count: number, full: boolean): Row => [
  { text: `↓ ${count} more`, tone: "muted" },
  ...(full
    ? []
    : [
        { text: "   " },
        { text: "[w]", tone: "accent" as const, bold: true },
        { text: " Full Screen", tone: "muted" as const },
      ]),
]

export function consoleRows(input: ConsoleInput): Row[] {
  const { width } = input
  if (!input.shell) {
    /** Said for the scope in force: "this project" while showing one session sent people looking. */
    const where = input.keys.scope === "session" ? "this session" : "this project"
    const empty = [
      fit([{ text: pad }, { text: `No shells in ${where}`, bold: true }], width, true),
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
  const lines = bodyLines(input, room)
  /**
   * Output keeps its newest rows, as a terminal does. Details keep their *first* rows: they are a
   * list read from the top, and keeping the bottom silently dropped `command`, the row that says what
   * the shell is, whenever a failure's reason made the head taller. What is cut is counted.
   */
  const kept =
    input.view !== "details"
      ? lines.slice(-room)
      : lines.length <= room
        ? lines
        : [...lines.slice(0, room - 1), moreRow(lines.length - room + 1, input.keys.full === true)]
  const body = kept.map((row) => fit([gutter, ...row], width))
  /** Output starts at the top of the body, as in a terminal; a shorter one leaves room below. */
  const blank = fit([gutter], width)
  const padded = [...body, ...Array<Row>(Math.max(0, room - body.length)).fill(blank)]
  return [...head, fit([], width), ...padded, fit([], width), fit(footer(input), width)]
}
