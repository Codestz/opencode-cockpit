/**
 * The ledger dialog: everything Trust has learned in this project, and what you can do about it.
 *
 *   Trust in this project                       3 in a row · dangerous +5 · unused 30 days expires
 *
 *   ● git status                                       bash · build   trusted · 7 auto · 2h ago
 *   ○ docker compose -p cockpit up -d                  bash · build              2/3 · 5m ago
 *   ○ git push origin main                git push     bash · build              5/8 · 1d ago
 *
 *   ! OpenCode's own "always" — broader than it looks, until OpenCode restarts
 *   ! docker compose -p *                              bash · build                   10m ago
 *
 *   [j/k] move   [x] revoke   [c] copy as config   [p] pause   [esc] close
 *
 * The rows are the same vocabulary as the sidebar's — a filled dot is trusted, a hollow one is
 * counting — so the dialog reads as the sidebar block, opened.
 */

import { type Always, type Entry, type State, standing, type Thresholds } from "../ledger.ts"
import { ago, filled, fit, type Row, type Run, spread, type Tone } from "./rows.ts"

export type LedgerItem = { kind: "rule"; entry: Entry } | { kind: "always"; always: Always }

/**
 * Trusted first, then those being counted, then the rest — each newest first. A subject that was
 * only ever rejected has nothing to show and is left out.
 */
export function ledgerItems(state: State, settings: Thresholds, now: number): LedgerItem[] {
  const rank = (entry: Entry) => {
    const where = standing(entry, entry.danger, settings, now)
    return where.trusted ? 0 : where.have > 0 ? 1 : 2
  }
  const rules = [...state.entries.values()]
    .filter((entry) => entry.approvals > 0 || entry.autos > 0)
    .sort((a, b) => rank(a) - rank(b) || b.lastAt - a.lastAt)
    .map((entry): LedgerItem => ({ kind: "rule", entry }))
  const always = [...state.always].reverse().map((always): LedgerItem => ({ kind: "always", always }))
  return [...rules, ...always]
}

export interface LedgerInput {
  width: number
  height: number
  items: readonly LedgerItem[]
  selected: number
  state: State
  settings: Thresholds
  now: number
  notice?: { text: string; tone: Tone }
  /** The key hints, already formatted for the keys actually bound. */
  keys?: readonly [string, string][]
}

export const DEFAULT_KEYS: readonly [string, string][] = [
  ["j/k", "move"],
  ["x", "revoke"],
  ["c", "copy as config"],
  ["p", "pause"],
  ["esc", "close"],
]

/** One item's parts: the left grows and gives way, the three on the right are columns. */
interface Cells {
  left: Run[]
  agent: string
  status: Run[]
  when: string
}

function cellsOf(item: LedgerItem, settings: Thresholds, now: number): Cells {
  if (item.kind === "always") {
    const { always } = item
    return {
      left: [
        { text: " ! ", tone: "warning" },
        ...(always.permission === "bash" ? [] : [{ text: `${always.permission} `, tone: "tool" as const }]),
        { text: always.patterns.join("  "), tone: "warning" },
      ],
      agent: always.agent,
      status: [{ text: "until restart", tone: "muted" }],
      when: ago(now - always.at),
    }
  }
  const { entry } = item
  const where = standing(entry, entry.danger, settings, now)
  return {
    left: [
      where.trusted ? { text: " ● ", tone: "success" } : { text: " ○ ", tone: "warning" },
      ...(entry.permission === "bash" ? [] : [{ text: `${entry.permission} `, tone: "tool" as const }]),
      { text: entry.subject, tone: "text" },
      ...(entry.danger ? [{ text: `  ${entry.danger}`, tone: "error" as const }] : []),
    ],
    agent: entry.agent,
    status: where.trusted
      ? [
          { text: "trusted", tone: "success" },
          ...(entry.autos > 0 ? [{ text: ` · ${entry.autos} auto`, tone: "muted" as const }] : []),
        ]
      : [
          {
            text: `${where.have}/${where.need}`,
            tone: where.expired ? "muted" : entry.danger ? "error" : "warning",
          },
        ],
    when: where.expired ? "expired" : ago(now - entry.lastAt),
  }
}

const textOf = (runs: readonly Run[]) => runs.map((run) => run.text).join("")

/** The right-hand columns sized to the widest in the list, so they read straight down. */
function rowOf(cells: Cells, columns: { agent: number; status: number; when: number }, width: number): Row {
  const status = textOf(cells.status)
  return spread(
    cells.left,
    [
      { text: cells.agent.padEnd(columns.agent + 2), tone: "info" },
      { text: " ".repeat(Math.max(0, columns.status - status.length)) },
      ...cells.status,
      { text: `  ${cells.when.padStart(columns.when)} `, tone: "muted" },
    ],
    width,
  )
}

export interface LedgerView {
  rows: Row[]
  /** The first item drawn, so the caller can keep the cursor in view on the next draw. */
  top: number
}

export function ledgerRows(input: LedgerInput): LedgerView {
  const { width, items, settings, now, state } = input
  const rows: Row[] = []
  const title = state.paused ? "Trust in this project — paused" : "Trust in this project"
  rows.push(
    spread(
      [{ text: ` ${title}`, tone: state.paused ? "warning" : "text", bold: true }],
      [
        {
          text: `${settings.threshold} in a row · dangerous +${settings.dangerExtra} · ${
            settings.expireDays > 0 ? `unused ${settings.expireDays} days expires` : "never expires"
          } `,
          tone: "muted",
        },
      ],
      width,
    ),
  )
  rows.push(fit([], width))

  const keys = input.keys ?? DEFAULT_KEYS
  const footer: Row = [
    { text: " " },
    ...keys.flatMap(([key, label]): Run[] => [
      { text: `[${key}]`, tone: "accent" },
      { text: ` ${label}   `, tone: "muted" },
    ]),
  ]
  /** Header, a gap, then the body; a gap, the notice row, the keys. */
  const room = Math.max(3, input.height - rows.length - 3)

  if (items.length === 0) {
    rows.push(
      fit(
        [
          {
            text: ` Nothing learned yet. Approve the same command ${settings.threshold} times in a row and Trust answers it from then on.`,
            tone: "muted",
          },
        ],
        width,
      ),
    )
    while (rows.length < 2 + room) rows.push(fit([], width))
    rows.push(fit([], width))
    rows.push(fit(input.notice ? [{ text: ` ${input.notice.text}`, tone: input.notice.tone }] : [], width))
    rows.push(fit(footer, width))
    return { rows, top: 0 }
  }

  /** The body as lines: the rules, then OpenCode's own approvals under a heading of their own. */
  const lines: { row: Row; item?: number }[] = []
  const cells = items.map((item) => cellsOf(item, settings, now))
  const columns = {
    agent: Math.max(...cells.map((each) => each.agent.length)),
    status: Math.max(...cells.map((each) => textOf(each.status).length)),
    when: Math.max(...cells.map((each) => each.when.length)),
  }
  let heading = false
  items.forEach((item, index) => {
    if (item.kind === "always" && !heading) {
      heading = true
      if (lines.length > 0) lines.push({ row: fit([], width) })
      lines.push({
        row: fit(
          [
            {
              text: ` OpenCode's own "always" — broader than it looks, and only until OpenCode restarts`,
              tone: "warning",
            },
          ],
          width,
        ),
      })
    }
    const row = rowOf(cells[index] as Cells, columns, width)
    lines.push({ row: index === input.selected ? filled(row, "selected") : row, item: index })
  })

  /** The cursor's line in view, with the lines around it. */
  const at = Math.max(
    0,
    lines.findIndex((line) => line.item === input.selected),
  )
  const top = Math.max(0, Math.min(at - Math.floor(room / 2), lines.length - room))
  const shown = lines.slice(top, top + room)
  for (const line of shown) rows.push(line.row)
  while (rows.length < 2 + room) rows.push(fit([], width))
  rows.push(fit([], width))
  rows.push(fit(input.notice ? [{ text: ` ${input.notice.text}`, tone: input.notice.tone }] : [], width))
  rows.push(fit(footer, width))
  return { rows, top }
}

/**
 * A rule as `opencode.json` would say it, for you to paste — Trust never writes OpenCode's config.
 * Where a command ran (`(in web)`) has no place in a config pattern, so it is left out and said so.
 */
export function configSnippet(item: LedgerItem): { text: string; note?: string } {
  if (item.kind === "always") {
    const patterns = Object.fromEntries(item.always.patterns.map((pattern) => [pattern, "allow"]))
    return { text: JSON.stringify({ permission: { [item.always.permission]: patterns } }) }
  }
  const { entry } = item
  const placed = entry.subject.match(/^\(in [^)]*\) (.*)$/s)
  const pattern =
    entry.permission === "webfetch"
      ? `https://${entry.subject}/*`
      : placed
        ? (placed[1] as string)
        : entry.subject
  const text = JSON.stringify({ permission: { [entry.permission]: { [pattern]: "allow" } } })
  return placed
    ? { text, note: "a config rule cannot say where a command runs: this one allows it anywhere" }
    : { text }
}
