/**
 * The sidebar block: what this conversation made, grouped by what it was for, one click from the page.
 *
 *   Trail                                            9
 *
 *   COM-1801
 *     ENG-42   Retry the sock…  Linear  created  15m ↗
 *   COM-1736   Bundle desync      Jira  updated   2h ↗
 *     PR #33   0.8: Trust, on…  GitHub  updated   1h ↗
 *   + 4 more · /trail
 *
 * (`COM-1801` heads its group by name: nothing here records the ticket itself.)
 *
 * A row: the ref (or kind) muted, the title, the system, then what this conversation last did and
 * when — muted, because it is history and not a state; nothing here goes stale, so nothing wears a
 * state's colour. `↗` marks a row a click opens in the browser.
 *
 * **Present when empty** (Gate 1): the heading and a muted `none yet` in the slot the first record
 * will take, so the first record replaces the line instead of pushing the blocks below down — the
 * client's `emptyBlock`, the same two rows every bay draws.
 *
 * **A settings notice always speaks**: under the heading, `!` and the words wrapped to the column
 * (`warnRows`), even with `hideWhenEmpty` — a typo in the config is never silent.
 *
 * Narrow, the row gives up its columns in order — the action, then the system, then the ref's width —
 * before the title drops below a readable few cells; whatever is cut ends in `…`.
 */

import {
  EMPTY_TEXT,
  emptyBlock,
  HEADING,
  HEADING_GAP,
  moreText,
  type ToneRun,
  warnRows,
} from "@opencode-cockpit/client/design"
import { type Arranged, type Line, lastOf, linesOf, type Thing } from "../model.ts"
import { age, cut, fit, type Row, type Run, spread, widthOf } from "./rows.ts"

export interface SidebarInput {
  width: number
  /** This conversation's trail, arranged. */
  arranged: Arranged
  now: number
  /** Rows of records before `+ N more`. */
  limit: number
  /** Draw nothing at all while the trail is empty (`hideWhenEmpty`). */
  hideWhenEmpty?: boolean
  /** Settings to fix, as sentences (`noticeText`): `!` rows under the heading, wrapped to fit. */
  notices?: readonly string[]
}

/** What a click on a row does: open a page, open `/trail` at a record, or open `/trail`. */
export type SidebarHit =
  | { y: number; kind: "open"; key: string; url: string }
  | { y: number; kind: "select"; key: string }
  | { y: number; kind: "more" }

export interface SidebarView {
  rows: Row[]
  hits: SidebarHit[]
}

export const OPEN_MARK = "↗"
/** The client's words for an empty block, so every bay says the same. */
export { EMPTY_TEXT }

/** The fewest cells a title is given before a column is dropped for it. */
const TITLE_MIN = 12
const LABEL_MAX = 10
const SYSTEM_MAX = 12
const ACTION_MAX = 10
const INDENT = 2

interface Columns {
  label: number
  system: number
  action: number
  age: number
}

const muted = (text: string): Run => ({ text, tone: "muted" })
const pad = (text: string, room: number) => `${text}${" ".repeat(Math.max(0, room - widthOf(text)))}`

function columnsFor(lines: readonly Line[], width: number, now: number): Columns {
  const things = lines.flatMap((line) => (line.kind === "thing" ? [line] : []))
  const most = (values: number[]) => Math.max(0, ...values)
  const full: Columns = {
    label: Math.min(
      LABEL_MAX,
      most(things.map(({ thing, depth }) => widthOf(thing.label ?? "") + depth * INDENT)),
    ),
    system: Math.min(SYSTEM_MAX, most(things.map(({ thing }) => widthOf(thing.system ?? "")))),
    action: Math.min(ACTION_MAX, most(things.map(({ thing }) => widthOf(lastOf(thing).action)))),
    age: most(things.map(({ thing }) => widthOf(age(now - lastOf(thing).at)))),
  }
  /** Two cells after the title; each column its width and two after it; the age; the mark's two. */
  const right = (c: Columns) => 2 + (c.system ? c.system + 2 : 0) + (c.action ? c.action + 2 : 0) + c.age + 2
  const titleRoom = (c: Columns) => width - (c.label ? c.label + 2 : 0) - right(c)
  const tries: Columns[] = [
    full,
    { ...full, action: 0 },
    { ...full, action: 0, system: 0 },
    { ...full, action: 0, system: 0, label: Math.min(full.label, 6) },
  ]
  return tries.find((c) => titleRoom(c) >= TITLE_MIN) ?? (tries.at(-1) as Columns)
}

function thingRow(thing: Thing, depth: 0 | 1, columns: Columns, width: number, now: number): Row {
  const last = lastOf(thing)
  const indent = " ".repeat(depth * INDENT)
  const label = columns.label
    ? [muted(pad(cut(`${indent}${thing.label ?? ""}`, columns.label), columns.label)), { text: "  " }]
    : [{ text: indent }]
  /** The system right-aligned, so a short name sits against the action like a column of numbers. */
  const right: Run[] = [
    { text: " " },
    ...(columns.system
      ? [
          { text: cut(thing.system ?? "", columns.system).padStart(columns.system), tone: "info" as const },
          { text: "  " },
        ]
      : []),
    ...(columns.action ? [muted(pad(cut(last.action, columns.action), columns.action)), { text: "  " }] : []),
    muted(age(now - last.at).padStart(columns.age)),
    { text: thing.openable ? ` ${OPEN_MARK}` : "  ", tone: "muted" },
  ]
  return spread([...label, { text: thing.title, tone: "text" }], right, width)
}

/** The client's rows are tone names and text, as ours are: each made exactly the width. */
const asRow = (runs: readonly ToneRun[], width: number): Row => fit([...runs], width)

export function sidebarRows(input: SidebarInput): SidebarView {
  const { width, arranged, now } = input
  const notices = input.notices ?? []
  if (width < 8 || (input.hideWhenEmpty && arranged.total === 0 && notices.length === 0))
    return { rows: [], hits: [] }
  const warned = notices.flatMap((text) => warnRows(text, width).map((runs) => asRow(runs, width)))
  if (arranged.total === 0) {
    /** Hidden when empty, a notice still draws, under the heading: a failure always speaks. */
    const [heading = [], ...rest] = emptyBlock("Trail", width).map((runs) => asRow(runs, width))
    const air = rest.slice(0, HEADING_GAP)
    const body = input.hideWhenEmpty ? [] : rest.slice(HEADING_GAP)
    return { rows: [heading, ...air, ...warned, ...body], hits: [] }
  }
  const rows: Row[] = []
  const hits: SidebarHit[] = []
  rows.push(spread([{ text: "Trail", ...HEADING }], [muted(String(arranged.total))], width))
  for (let gap = 0; gap < HEADING_GAP; gap++) rows.push(fit([], width))
  rows.push(...warned)

  const lines = linesOf(arranged)
  const shown = lines.length > input.limit ? lines.slice(0, Math.max(1, input.limit)) : lines
  const columns = columnsFor(shown, width, now)
  for (const line of shown) {
    const y = rows.length
    if (line.kind === "head") {
      rows.push(fit([{ text: line.name, tone: "text" }], width))
      continue
    }
    rows.push(thingRow(line.thing, line.depth, columns, width, now))
    hits.push(
      line.thing.openable && line.thing.url
        ? { y, kind: "open", key: line.thing.key, url: line.thing.url }
        : { y, kind: "select", key: line.thing.key },
    )
  }
  const hidden = lines.slice(shown.length).filter((line) => line.kind === "thing").length
  if (hidden > 0) {
    hits.push({ y: rows.length, kind: "more" })
    rows.push(fit([muted(`${moreText(hidden)} · /trail`)], width))
  }
  return { rows, hits }
}
