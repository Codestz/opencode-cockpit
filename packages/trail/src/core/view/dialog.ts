/**
 * `/trail`: the whole trail, for this conversation or every conversation in the project.
 *
 *    Trail · opencode-cockpit         [tab]  This conversation   All conversations
 *
 *    COM-1736    Bundle desync                  Jira   updated             2h ago ↗
 *      PR #33    0.8: Trust, one design s…    GitHub   created → updated   1h ago ↗
 *    Rollout checklist · docs                 Claude   created            30m ago ↗
 *
 * A record with no ref gives its title the ref's column (`refOf`), and the time is when, said so
 * (`since`), as in the sidebar.
 *
 *    [enter] Open   [g] Go   [c] Copy   [x] Remove   [/] Search   …   [esc] Close
 *
 * The same `arrange` as the sidebar and `trail_list`, so the three cannot disagree. *All
 * conversations* lists, under a thing other conversations touched too, each conversation that did —
 * a row of its own, so `g` on it goes there (to the root: a subagent's view has no sidebar,
 * docs/opencode/trail-interface.md). A conversation since deleted keeps its row, marked.
 *
 * Keys with nothing to act on under the cursor are dimmed, not removed (design-system.md); narrow,
 * a dimmed key gives way a little before a live one of the same rank.
 */

import { closeHint, fitHints, type Hint } from "@opencode-cockpit/client/design"
import {
  type Arranged,
  arrange,
  conversationThings,
  lastOf,
  linesOf,
  projectThings,
  type Thing,
  type Touch,
} from "../model.ts"
import { historyText, type State } from "../store.ts"
import { cursorRow, cut, fit, type Row, type Run, refOf, since, spread, widthOf } from "./rows.ts"

export type Tab = "this" | "all"

export const TAB_NAMES: Readonly<{ [T in Tab]: { long: string; short: string } }> = {
  this: { long: "This conversation", short: "This" },
  all: { long: "All conversations", short: "All" },
}

export interface DialogInput {
  width: number
  height: number
  tab: Tab
  state: State
  /** The conversation on screen (its root session). */
  session: string
  now: number
  /** The project's folder name, for the header. */
  project: string
  /** The key of the item under the cursor; the first when unset or gone. */
  selected?: string
  query?: string
  /** `/` was pressed: the query is being typed. */
  searching?: boolean
}

/** Something the cursor can sit on. */
export type Item =
  | { kind: "thing"; key: string; thing: Thing }
  /** One conversation's part in a thing, under it in All conversations. */
  | { kind: "touch"; key: string; thing: Thing; touch: Touch }

/** What the keys do to the item under the cursor. Absent: nothing to do, and the key is dimmed. */
export interface Target {
  /** `enter`: the page to open (http(s) only). */
  open?: string
  /** `g`: the conversation to go to. */
  go?: string
  /** `c`: what to copy — the link, else the ref. */
  copy?: string
  /** `x`: the record to remove. */
  remove?: string
}

export interface DialogView {
  rows: Row[]
  items: Item[]
  item?: Item
  target: Target
  /** The rows a click selects. */
  hits: { y: number; key: string }[]
  arranged: Arranged
}

/** The fewest rows the dialog is drawn in: header, a row of air, a few rows, air, keys. */
export const MIN_HEIGHT = 8
const LABEL_MAX = 14
const SYSTEM_MAX = 14
const HISTORY_MAX = 26
const HISTORY_USUAL = 17
const LABEL_NARROW = 10
/** At least this much of the row is the title before a column is let go for it. */
const titleMin = (width: number) => Math.max(20, Math.floor(width * 0.32))
const INDENT = 2

const muted = (text: string): Run => ({ text, tone: "muted" })
const keyRun = (name: string): Run => ({ text: `[${name}]`, tone: "accent", bold: true })
const chip = (system: string): Run => ({ text: ` ${system} `, tone: "info", fill: "chip" })
const pad = (text: string, room: number) => `${text}${" ".repeat(Math.max(0, room - widthOf(text)))}`
const cell = (text: string, room: number) => pad(cut(text, room), room)

export function targetOf(item: Item | undefined, tab: Tab, session: string): Target {
  if (!item) return {}
  const { thing } = item
  const copy = thing.url ?? thing.ref ?? thing.title
  const open = thing.openable ? thing.url : undefined
  const touch = item.kind === "touch" ? item.touch : tab === "all" ? thing.touches[0] : undefined
  const go = touch && touch.session !== session ? touch.session : undefined
  /** In All conversations a thing several conversations touched is removed one conversation at a time. */
  const remove =
    item.kind === "touch"
      ? item.touch.record
      : thing.touches.length === 1
        ? thing.touches[0]?.record
        : undefined
  return {
    ...(open ? { open } : {}),
    ...(go ? { go } : {}),
    copy,
    ...(remove ? { remove } : {}),
  }
}

function hintsFor(target: Target, searching: boolean): Hint[] {
  if (searching)
    return [
      { key: "enter", label: "Done", priority: 9 },
      { key: "esc", label: "Cancel", close: true },
    ]
  /** A key with something to do under the cursor gives way after a dimmed one of about its rank. */
  const hint = (key: string, label: string, priority: number, on: unknown): Hint =>
    on ? { key, label, priority: priority + 3 } : { key, label, priority, off: true }
  return [
    hint("enter", "Open", 9, target.open),
    hint("g", "Go", 6, target.go),
    hint("c", "Copy", 7, target.copy),
    hint("x", "Remove", 4, target.remove),
    hint("/", "Search", 8, true),
    hint("m", "Markdown", 1, true),
    closeHint(),
  ]
}

function headerRow(input: DialogInput, width: number): Row {
  const left: Run[] = [
    { text: " Trail", tone: "text", bold: true },
    ...(input.project ? [muted(` · ${input.project}`)] : []),
  ]
  const tabs = (long: boolean): Run[] => [
    keyRun("tab"),
    { text: " " },
    ...(["this", "all"] as const).flatMap((tab, at): Run[] => {
      const name = long ? TAB_NAMES[tab].long : TAB_NAMES[tab].short
      return [
        ...(at > 0 ? [{ text: " " }] : []),
        tab === input.tab
          ? { text: ` ${name} `, tone: "text", fill: "chip", bold: true }
          : { text: ` ${name} `, tone: "muted" },
      ]
    }),
    { text: " " },
  ]
  const textOf = (runs: Run[]) => runs.map((run) => run.text).join("")
  const long = tabs(true)
  const room = width - widthOf(textOf(left)) - 2
  return spread(left, widthOf(textOf(long)) <= room ? long : tabs(false), width)
}

interface Columns {
  label: number
  system: number
  history: number
  age: number
}

function columnsFor(
  things: readonly { thing: Thing; depth: number }[],
  input: DialogInput,
  width: number,
): Columns {
  const most = (values: number[]) => Math.max(0, ...values)
  const full: Columns = {
    label: Math.min(
      LABEL_MAX,
      most(things.map(({ thing, depth }) => widthOf(refOf(thing) ?? "") + depth * INDENT)),
    ),
    system: Math.min(
      SYSTEM_MAX,
      most(things.map(({ thing }) => (thing.system ? widthOf(thing.system) + 2 : 0))),
    ),
    history: Math.min(HISTORY_MAX, most(things.map(({ thing }) => widthOf(historyText(thing))))),
    age: most(things.map(({ thing }) => widthOf(since(input.now - lastOf(thing).at)))),
  }
  /** Margin, label and its gap; then each right column and its gap, the age, the mark and a margin. */
  const titleRoom = (c: Columns) =>
    width -
    1 -
    (c.label ? c.label + 2 : 0) -
    (c.system ? c.system + 2 : 0) -
    (c.history ? c.history + 2 : 0) -
    c.age -
    3
  /** Narrower, the columns give way in turn: the history to its usual length, the ref's width, then
   *  the history, then the system. The title keeps at least `titleMin` while anything can go. */
  const usual = { ...full, history: Math.min(full.history, HISTORY_USUAL) }
  const tries: Columns[] = [
    full,
    usual,
    { ...usual, label: Math.min(usual.label, LABEL_NARROW) },
    { ...usual, label: Math.min(usual.label, LABEL_NARROW), history: 0 },
    { ...usual, label: Math.min(usual.label, LABEL_NARROW), history: 0, system: 0 },
  ]
  return tries.find((c) => titleRoom(c) >= titleMin(width)) ?? (tries.at(-1) as Columns)
}

function rightOf(
  system: string | undefined,
  history: string,
  at: number,
  openable: boolean,
  columns: Columns,
  now: number,
): Run[] {
  return [
    ...(columns.system
      ? [
          { text: " ".repeat(Math.max(0, columns.system - (system ? widthOf(system) + 2 : 0))) },
          ...(system ? [chip(cut(system, columns.system - 2))] : []),
          { text: "  " },
        ]
      : []),
    ...(columns.history ? [muted(cell(history, columns.history)), { text: "  " }] : []),
    muted(since(now - at).padStart(columns.age)),
    { text: openable ? " ↗ " : "   ", tone: "muted" },
  ]
}

function thingRow(thing: Thing, depth: number, input: DialogInput, columns: Columns, width: number): Row {
  const last = lastOf(thing)
  const indent = " ".repeat(depth * INDENT)
  const who = thing.touches[0]
  const by =
    input.tab === "this" && who
      ? who.by === "you"
        ? " · you"
        : who.subagent
          ? ` · ${who.subagent}`
          : ""
      : ""
  /** With no ref, the title starts where the ref would; its kind is not repeated beside the chip. */
  const ref = refOf(thing)
  return spread(
    [
      { text: " " },
      ...(columns.label && ref
        ? [muted(cell(`${indent}${ref}`, columns.label)), { text: "  " }]
        : [{ text: indent }]),
      { text: thing.title, tone: "text" },
      ...(by ? [muted(by)] : []),
    ],
    rightOf(thing.system, historyText(thing), last.at, thing.openable, columns, input.now),
    width,
  )
}

function touchRow(touch: Touch, depth: number, input: DialogInput, columns: Columns, width: number): Row {
  const indent = " ".repeat((depth + 1) * INDENT)
  const name = touch.title ? `“${touch.title}”` : "untitled conversation"
  const marks = [
    ...(touch.session === input.session ? ["this conversation"] : []),
    ...(touch.deleted ? ["deleted"] : []),
    ...(touch.subagent ? [touch.subagent] : []),
    ...(touch.by === "you" ? ["you"] : []),
  ]
  const at = touch.history.at(-1)?.at ?? touch.lastAt
  return spread(
    [
      { text: " " },
      ...(columns.label ? [{ text: " ".repeat(columns.label + 2) }] : []),
      muted(`${indent}↳ `),
      { text: name, tone: touch.deleted ? "muted" : "text" },
      ...(marks.length > 0 ? [muted(` · ${marks.join(" · ")}`)] : []),
    ],
    rightOf(undefined, historyText(touch), at, false, { ...columns, system: 0 }, input.now),
    width,
  )
}

/** Wrapped muted prose, a cell of margin each side: what an empty tab says. */
function prose(text: string, width: number): Row[] {
  const room = Math.max(8, width - 4)
  const out: Row[] = []
  let line = ""
  for (const word of text.split(" ")) {
    if (line && widthOf(`${line} ${word}`) > room) {
      out.push(fit([muted(`   ${line}`)], width))
      line = word
    } else line = line ? `${line} ${word}` : word
  }
  if (line) out.push(fit([muted(`   ${line}`)], width))
  return out
}

export function dialogRows(input: DialogInput): DialogView {
  const width = Math.max(20, input.width)
  const height = Math.max(MIN_HEIGHT, input.height)
  const query = input.query ?? ""
  const things =
    input.tab === "all" ? projectThings(input.state) : conversationThings(input.state, input.session)
  const arranged = arrange(things, query)
  const lines = linesOf(arranged)

  /** The body, each row with the item it selects. */
  const body: { row: Row; item?: Item }[] = []
  const placed = lines.flatMap((line) => (line.kind === "thing" ? [line] : []))
  const columns = columnsFor(placed, input, width)

  if (arranged.total === 0)
    body.push(
      {
        row: fit(
          [
            {
              text:
                input.tab === "this"
                  ? " Nothing recorded in this conversation yet."
                  : " Nothing recorded in this project yet.",
              tone: "text",
            },
          ],
          width,
        ),
      },
      ...prose(
        "The agent records what it creates or changes outside the repository — a PR, a ticket, a page, a deploy — with trail_add. Add one yourself: /link, then paste the link (and a note).",
        width,
      ).map((row) => ({ row })),
    )
  else if (arranged.shown === 0)
    body.push({ row: fit([{ text: ` Nothing matches “${query}”.`, tone: "text" }], width) })

  for (const line of lines) {
    if (line.kind === "head") {
      body.push({
        row: fit(
          [{ text: " " }, { text: line.name, tone: "text", bold: true }, muted("  not recorded itself")],
          width,
        ),
      })
      continue
    }
    const { thing, depth } = line
    body.push({
      row: thingRow(thing, depth, input, columns, width),
      item: { kind: "thing", key: thing.key, thing },
    })
    /** A thing only this conversation touched needs no row saying so: there is nowhere to go. */
    const elsewhere = thing.touches.some((touch) => touch.session !== input.session)
    if (input.tab === "all" && elsewhere)
      for (const touch of thing.touches)
        body.push({
          row: touchRow(touch, depth, input, columns, width),
          item: { kind: "touch", key: `${thing.key}\n${touch.session}`, thing, touch },
        })
  }

  const items = body.flatMap((entry) => (entry.item ? [entry.item] : []))
  const item = items.find((each) => each.key === input.selected) ?? items[0]
  const target = targetOf(item, input.tab, input.session)

  /* The frame: header, search, air, the body's window, air, keys. */
  const rows: Row[] = [headerRow(input, width)]
  if (input.searching || query) {
    const count = query
      ? muted(`${arranged.shown} of ${arranged.total} `)
      : muted("title, ref, kind, system ")
    rows.push(
      spread(
        [
          { text: " " },
          keyRun("/"),
          { text: " " },
          { text: query, tone: "text" },
          ...(input.searching ? [{ text: "▍", tone: "accent" as const }] : []),
        ],
        [count],
        width,
      ),
    )
  }
  rows.push(fit([], width))
  const room = height - rows.length - 2
  const at = Math.max(
    0,
    body.findIndex((entry) => entry.item === item),
  )
  let start = 0
  let end = body.length
  if (body.length > room) {
    /** Keep the cursor in view, a row of the list above it when there is one. */
    start = Math.min(Math.max(0, at - 1), body.length - room)
    end = start + room
    if (start > 0) start++
    if (end < body.length) end--
  }
  const hits: { y: number; key: string }[] = []
  if (start > 0) rows.push(fit([muted(` ↑ ${start} more`)], width))
  for (const entry of body.slice(start, end)) {
    if (entry.item) hits.push({ y: rows.length, key: entry.item.key })
    rows.push(entry.item && entry.item === item ? cursorRow(entry.row, width) : entry.row)
  }
  if (end < body.length) rows.push(fit([muted(` ↓ ${body.length - end} more`)], width))
  while (rows.length < height - 2) rows.push(fit([], width))
  rows.push(fit([], width))
  const fitted = fitHints(hintsFor(target, input.searching === true), Math.max(0, width - 2))
  rows.push(fit([{ text: " " }, ...fitted.runs], width))

  return { rows, items, ...(item ? { item } : {}), target, hits, arranged }
}
