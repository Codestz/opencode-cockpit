/**
 * What every surface reads — the sidebar, `/trail`, `trail_list`, the system lines and the markdown
 * copy: the things a conversation (or the whole project) made, each once, in one order.
 *
 * **One truth** (principles.md, rule 2): the dialog and the tool are two drawings of `arrange`'s
 * result, never two queries that could disagree.
 *
 * **Ordered by the work, not by the tool.** A record names what it is `for` — a ticket heads the PRs
 * made for it; inside a group, newest first. Groups come first, newest work first; things that belong
 * to nothing stand alone after them, newest first. A `for` nothing here records (a ticket the agent
 * never touched) still heads its group, by name.
 *
 * **All conversations** is one row per thing, by its link (else its ref), listing every conversation
 * that touched it — so a ticket worked on in three conversations is one row with three jumps.
 */

import { httpUrl, linkKey, openable, systemOf, workIn, workOf } from "./links.ts"
import type { By, Entry, State, Step } from "./store.ts"

/** One conversation's part in a thing. */
export interface Touch {
  session: string
  /** The conversation's title, as written down when it recorded. */
  title?: string
  deleted: boolean
  /** The record's key: what `x` removes. */
  record: string
  history: Step[]
  by: By
  subagent?: string
  lastAt: number
}

export interface Thing {
  /** The record's key, or in All conversations the link (else ref) every touch shares. */
  key: string
  title: string
  url?: string
  ref?: string
  kind?: string
  for?: string
  note?: string
  /** From the link: `GitHub`, `Jira`, `notion.so`. */
  system?: string
  /** How a row names it: `PR #33`, `COM-1736`, else the ref, else the kind. */
  label?: string
  /** Has an `http(s)` link: `enter` and a click open it. */
  openable: boolean
  /** Every action, oldest first, across the touches. */
  history: Step[]
  firstAt: number
  lastAt: number
  /** The conversations that touched it, the latest first. One in This conversation. */
  touches: Touch[]
}

/** `PR #33` for a PR link, the ref as given, the kind when there is neither. */
export function labelOf(entry: Pick<Entry, "url" | "ref" | "kind">): string | undefined {
  const work = workOf(entry.url)
  if (work) return work.label
  return entry.ref ?? entry.kind
}

function touchOf(state: State, record: Entry): Touch {
  const conversation = state.conversations.get(record.session)
  return {
    session: record.session,
    ...(conversation?.title ? { title: conversation.title } : {}),
    deleted: conversation?.deletedAt !== undefined,
    record: record.key,
    history: record.history,
    by: record.by,
    ...(record.subagent ? { subagent: record.subagent } : {}),
    lastAt: record.lastAt,
  }
}

function thingOf(key: string, records: readonly Entry[], state: State): Thing {
  const sorted = [...records].sort((a, b) => b.lastAt - a.lastAt)
  const latest = sorted[0] as Entry
  /** The latest record's words, and any field only an older one gave. */
  const pick = <K extends "url" | "ref" | "kind" | "for" | "note">(field: K) =>
    sorted.find((record) => record[field] !== undefined)?.[field]
  const url = pick("url")
  const ref = pick("ref")
  const kind = pick("kind")
  const forWhat = pick("for")
  const note = pick("note")
  const system = systemOf(url)
  const label = labelOf({ url, ref, kind })
  return {
    key,
    title: latest.title,
    ...(url ? { url } : {}),
    ...(ref ? { ref } : {}),
    ...(kind ? { kind } : {}),
    ...(forWhat ? { for: forWhat } : {}),
    ...(note ? { note } : {}),
    ...(system ? { system } : {}),
    ...(label ? { label } : {}),
    openable: openable(url),
    history: sorted.flatMap((record) => record.history).sort((a, b) => a.at - b.at),
    firstAt: Math.min(...sorted.map((record) => record.firstAt)),
    lastAt: latest.lastAt,
    touches: sorted.map((record) => touchOf(state, record)),
  }
}

/** What one conversation made, one thing per record. */
export function conversationThings(state: State, session: string): Thing[] {
  return [...state.records.values()]
    .filter((record) => record.session === session)
    .map((record) => thingOf(record.key, [record], state))
}

/** The same thing across conversations: its link, else its ref. */
export const thingKey = (entry: Pick<Entry, "url" | "ref" | "key">): string =>
  entry.url ? linkKey(entry.url) : entry.ref ? `ref:${entry.ref.trim().toLowerCase()}` : entry.key

/** What the project's conversations made, one thing per link. */
export function projectThings(state: State): Thing[] {
  const by = new Map<string, Entry[]>()
  for (const record of state.records.values()) {
    const key = thingKey(record)
    by.set(key, [...(by.get(key) ?? []), record])
  }
  return [...by].map(([key, records]) => thingOf(key, records, state))
}

/* ─── search ─────────────────────────────────────────────────────────────────────────────────── */

/** Every word of `query` somewhere in the thing's title, ref, kind or system (or how it is named). */
export function matches(thing: Thing, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const hay = [thing.title, thing.ref, thing.label, thing.kind, thing.system, thing.for]
    .filter(Boolean)
    .join("\n")
    .toLowerCase()
  return words.every((word) => hay.includes(word))
}

/* ─── order ──────────────────────────────────────────────────────────────────────────────────── */

export interface Group {
  /** The thing the others are for — or, when nothing here records it, its name. */
  head: Thing | string
  children: Thing[]
  lastAt: number
}

export interface Arranged {
  groups: Group[]
  /** Things that belong to nothing here, and head nothing. */
  alone: Thing[]
  /** How many things, before a query. */
  total: number
  /** How many the query kept. */
  shown: number
}

/** Does `target` name this thing — its ref, its link, or how it is labelled? */
function names(thing: Thing, target: string): boolean {
  const wanted = target.trim().toLowerCase()
  if (!wanted) return false
  if (thing.ref?.toLowerCase() === wanted || thing.label?.toLowerCase() === wanted) return true
  return thing.url !== undefined && httpUrl(target) !== undefined && linkKey(thing.url) === linkKey(target)
}

/** A `for` nothing records, named the way a row would name it: a ticket link is its key. */
function forName(target: string): string {
  const work = workOf(target)
  return work ? work.label : target
}

const newestFirst = (a: Thing, b: Thing) => b.lastAt - a.lastAt

export function arrange(things: readonly Thing[], query = ""): Arranged {
  /**
   * Each thing's head, walked to the top so a chain is one group. A chain that ends on a name nothing
   * records is headed by that name. One that loops is headed by its oldest thing, which heads nothing
   * itself — so every thing is drawn once.
   */
  const headOf = new Map<Thing, Thing | string>()
  for (const thing of things) {
    let at: Thing = thing
    let head: Thing | string | undefined
    const passed: Thing[] = [thing]
    for (let hop = 0; hop < 8 && at.for; hop++) {
      const target = at.for
      const found = things.find((other) => other !== at && names(other, target))
      if (!found) {
        head = forName(target)
        break
      }
      if (passed.includes(found)) {
        const loop = passed.slice(passed.indexOf(found))
        const oldest = loop.reduce((a, b) => (b.firstAt < a.firstAt ? b : a))
        head = oldest === thing ? undefined : oldest
        break
      }
      head = found
      passed.push(found)
      at = found
    }
    if (head !== undefined) headOf.set(thing, head)
  }

  const kept = new Set(things.filter((thing) => matches(thing, query)))
  const groups = new Map<Thing | string, Thing[]>()
  /** A virtual head is keyed by its name, case-blind, so two spellings of COM-1736 are one group. */
  const virtual = new Map<string, string>()
  for (const thing of things) {
    let head = headOf.get(thing)
    if (head === undefined) continue
    if (typeof head === "string") {
      const key = head.toLowerCase()
      head = virtual.get(key) ?? head
      virtual.set(key, head)
    }
    if (!groups.has(head)) groups.set(head, [])
    if (kept.has(thing)) (groups.get(head) as Thing[]).push(thing)
  }

  const out: Group[] = []
  for (const [head, children] of groups) {
    const headKept = typeof head !== "string" && kept.has(head)
    /** A query keeps a group when it found the head or a child; the head stays as context. */
    if (children.length === 0 && !headKept) continue
    children.sort(newestFirst)
    const times = [...children.map((child) => child.lastAt), typeof head === "string" ? 0 : head.lastAt]
    out.push({ head, children, lastAt: Math.max(...times) })
  }
  out.sort((a, b) => b.lastAt - a.lastAt)

  const heads = new Set([...groups.keys()].filter((head): head is Thing => typeof head !== "string"))
  const alone = things.filter((thing) => kept.has(thing) && !headOf.has(thing) && !heads.has(thing))
  alone.sort(newestFirst)
  const shown = new Set([
    ...out.flatMap((group) => [
      ...group.children,
      ...(typeof group.head !== "string" && kept.has(group.head) ? [group.head] : []),
    ]),
    ...alone,
  ]).size
  return { groups: out, alone, total: things.length, shown }
}

/** One row of an arranged trail: a thing (under its head, or not), or a head nothing records. */
export type Line =
  | { kind: "thing"; thing: Thing; depth: 0 | 1 }
  | { kind: "head"; name: string; children: number }

export function linesOf(arranged: Arranged): Line[] {
  const lines: Line[] = []
  for (const group of arranged.groups) {
    lines.push(
      typeof group.head === "string"
        ? { kind: "head", name: group.head, children: group.children.length }
        : { kind: "thing", thing: group.head, depth: 0 },
    )
    for (const child of group.children) lines.push({ kind: "thing", thing: child, depth: 1 })
  }
  for (const thing of arranged.alone) lines.push({ kind: "thing", thing, depth: 0 })
  return lines
}

/* ─── found, not recorded ────────────────────────────────────────────────────────────────────── */

/** A PR or issue link seen in the output of something the agent ran. */
export interface Found {
  url: string
  ref: string
  label: string
  system?: string
  /** When it was first seen. */
  at: number
}

/** The PRs and issues in a command's output, as finds. */
export function foundIn(text: string, at: number): Found[] {
  return workIn(text).map((work) => {
    const system = systemOf(work.url)
    return { url: work.url, ref: work.ref, label: work.label, ...(system ? { system } : {}), at }
  })
}

/**
 * The finds this conversation has not recorded, newest first, once each — the safety net's whole
 * output. A record matches by link, or by the ref the link derives (`owner/repo#33`).
 */
export function notRecorded(state: State, session: string, seen: readonly Found[]): Found[] {
  const records = [...state.records.values()].filter((record) => record.session === session)
  const links = new Set(records.flatMap((record) => (record.url ? [linkKey(record.url)] : [])))
  const refs = new Set(records.flatMap((record) => (record.ref ? [record.ref.toLowerCase()] : [])))
  const out = new Map<string, Found>()
  for (const found of seen) {
    const key = linkKey(found.url)
    if (links.has(key) || refs.has(found.ref.toLowerCase())) continue
    const had = out.get(key)
    if (!had || had.at > found.at) out.set(key, found)
  }
  return [...out.values()].sort((a, b) => b.at - a.at)
}

/** The last thing done to it, and when. */
export const lastOf = (thing: Pick<Thing, "history" | "lastAt">): { action: string; at: number } => {
  const step = thing.history.at(-1)
  return { action: step?.action ?? "recorded", at: step?.at ?? thing.lastAt }
}
