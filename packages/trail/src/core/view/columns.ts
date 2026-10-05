/**
 * The columns of `/trail`: how wide each is at a width — ref, title, system, history, age, a column
 * let go before the title gets too short — and a thing's or a touch's row laid out in them.
 */

import { lastOf, type Thing, type Touch } from "../model.ts"
import { historyText } from "../store.ts"
import type { DialogInput } from "./dialog.ts"
import { cut, type Row, type Run, refOf, since, spread, widthOf } from "./rows.ts"

const LABEL_MAX = 14
const SYSTEM_MAX = 14
const HISTORY_MAX = 26
const HISTORY_USUAL = 17
const LABEL_NARROW = 10
/** At least this much of the row is the title before a column is let go for it. */
const titleMin = (width: number) => Math.max(20, Math.floor(width * 0.32))
const INDENT = 2

export const muted = (text: string): Run => ({ text, tone: "muted" })
const chip = (system: string): Run => ({ text: ` ${system} `, tone: "info", fill: "chip" })
const pad = (text: string, room: number) => `${text}${" ".repeat(Math.max(0, room - widthOf(text)))}`
const cell = (text: string, room: number) => pad(cut(text, room), room)

export interface Columns {
  label: number
  system: number
  history: number
  age: number
}

export function columnsFor(
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

export function thingRow(
  thing: Thing,
  depth: number,
  input: DialogInput,
  columns: Columns,
  width: number,
): Row {
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

export function touchRow(
  touch: Touch,
  depth: number,
  input: DialogInput,
  columns: Columns,
  width: number,
): Row {
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
