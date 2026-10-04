/**
 * The trail: what each conversation made, one event per line, and what it adds up to.
 *
 * Append-only, for Trust's reasons (`trust/src/core/ledger.ts`): several OpenCode windows — and on
 * OpenCode 1 one agent instance per directory — write to the same file, and a whole line appended in
 * one write is the only update that needs no lock. The records are never stored; they are a fold over
 * the events, so a record's history (`created → updated`) is there to read, and every reader that
 * has seen the same lines holds the same trail.
 *
 * **One thing, one record.** A conversation that records the same link twice — or, with no link, the
 * same ref — has one record whose actions are a history, never two rows. The later title wins: the
 * same url again with a better title is how a record is corrected.
 *
 * **Each record keeps its conversation's title.** A deleted conversation vanishes from OpenCode, and
 * OpenCode 2 does not even say what it was called (docs/opencode/trail-interface.md), so the title
 * is written down when the record is, and a `deleted` event marks the records as orphans rather than
 * removing them.
 */

import { linkKey } from "./links.ts"

export type By = "agent" | "you"

/** Every event: when, and an id so two readers of one line never apply it twice. */
interface Base {
  v: 1
  at: number
  id: string
  /** The conversation it belongs to: the root session, whichever subagent made it. */
  rootSession: string
}

/** The fields of a thing, as the agent or a person gave them (cleaned by `add.ts`). */
export interface Fields {
  title: string
  url?: string
  ref?: string
  kind?: string
  action: string
  for?: string
  note?: string
}

export type Event =
  | (Base &
      Fields & {
        type: "recorded"
        /** The session the call was made in: a subagent's own, or the conversation itself. */
        session: string
        sessionTitle?: string
        by: By
        /** The subagent that made it, when one did. */
        subagent?: string
      })
  /** You took a record out of the trail (`x`). */
  | (Base & { type: "removed"; record: string })
  /** The conversation was deleted in OpenCode; its records stay, marked. */
  | (Base & { type: "deleted"; sessionTitle?: string })

export interface Step {
  action: string
  at: number
  by: By
  subagent?: string
}

export interface Entry {
  /** The id of the event that first recorded it: stable for every reader of the file. */
  key: string
  /** The conversation (root session). */
  session: string
  title: string
  url?: string
  ref?: string
  kind?: string
  for?: string
  note?: string
  /** Who first recorded it. */
  by: By
  subagent?: string
  /** Everything this conversation did to it, oldest first. */
  history: Step[]
  firstAt: number
  lastAt: number
}

export interface Conversation {
  session: string
  title?: string
  /** When it was deleted in OpenCode, if it was. */
  deletedAt?: number
  lastAt: number
}

export interface State {
  records: Map<string, Entry>
  conversations: Map<string, Conversation>
  /** Event ids already applied. */
  seen: Set<string>
}

export const emptyState = (): State => ({ records: new Map(), conversations: new Map(), seen: new Set() })

const refKey = (ref: string) => ref.trim().toLowerCase()

/**
 * The record in `session` that a new mention of `url` / `ref` is about: the same link first, else the
 * same ref. Nothing when it is new.
 */
export function matchRecord(
  state: State,
  session: string,
  url: string | undefined,
  ref: string | undefined,
): Entry | undefined {
  const records = [...state.records.values()].filter((record) => record.session === session)
  if (url) {
    const key = linkKey(url)
    const hit = records.find((record) => record.url !== undefined && linkKey(record.url) === key)
    if (hit) return hit
  }
  if (ref) {
    const key = refKey(ref)
    return records.find((record) => record.ref !== undefined && refKey(record.ref) === key)
  }
  return undefined
}

function conversation(state: State, session: string, at: number): Conversation {
  let found = state.conversations.get(session)
  if (!found) {
    found = { session, lastAt: at }
    state.conversations.set(session, found)
  }
  found.lastAt = Math.max(found.lastAt, at)
  return found
}

export function apply(state: State, event: Event): State {
  if (state.seen.has(event.id)) return state
  state.seen.add(event.id)
  const where = conversation(state, event.rootSession, event.at)
  switch (event.type) {
    case "recorded": {
      if (event.sessionTitle) where.title = event.sessionTitle
      const step: Step = {
        action: event.action,
        at: event.at,
        by: event.by,
        ...(event.subagent ? { subagent: event.subagent } : {}),
      }
      const found = matchRecord(state, event.rootSession, event.url, event.ref)
      if (!found) {
        state.records.set(event.id, {
          key: event.id,
          session: event.rootSession,
          title: event.title,
          ...(event.url ? { url: event.url } : {}),
          ...(event.ref ? { ref: event.ref } : {}),
          ...(event.kind ? { kind: event.kind } : {}),
          ...(event.for ? { for: event.for } : {}),
          ...(event.note ? { note: event.note } : {}),
          by: event.by,
          ...(event.subagent ? { subagent: event.subagent } : {}),
          history: [step],
          firstAt: event.at,
          lastAt: event.at,
        })
        return state
      }
      /** What was said again replaces what was said before; what was left out is kept. */
      found.title = event.title
      for (const field of ["url", "ref", "kind", "for", "note"] as const) {
        const value = event[field]
        if (value) found[field] = value
      }
      found.history.push(step)
      found.history.sort((a, b) => a.at - b.at)
      found.lastAt = Math.max(found.lastAt, event.at)
      return state
    }
    case "removed":
      state.records.delete(event.record)
      return state
    case "deleted":
      if (event.sessionTitle && !where.title) where.title = event.sessionTitle
      where.deletedAt ??= event.at
      return state
  }
}

export function applyAll(state: State, events: readonly Event[]): State {
  for (const event of events) apply(state, event)
  return state
}

/** A record's actions as a person reads them: `created → updated`, a repeat said once. */
export function historyText(record: Pick<Entry, "history">, joiner = " → "): string {
  const said: string[] = []
  for (const step of record.history) if (said.at(-1) !== step.action) said.push(step.action)
  return said.join(joiner)
}

/**
 * Conversations that have records but no longer exist in OpenCode: what a reader that just listed the
 * sessions should mark `deleted`. Only roots the host was asked about can be judged, so the caller
 * passes every live session it knows of.
 */
export function vanished(state: State, live: ReadonlySet<string>): Conversation[] {
  const out: Conversation[] = []
  for (const conversation of state.conversations.values()) {
    if (conversation.deletedAt !== undefined || live.has(conversation.session)) continue
    if ([...state.records.values()].some((record) => record.session === conversation.session))
      out.push(conversation)
  }
  return out
}

/** A fresh event id: unique across windows without coordinating. */
export function newId(): string {
  return `tr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

/* ─── the file ───────────────────────────────────────────────────────────────────────────────── */

const str = (value: unknown) => typeof value === "string"
const optStr = (value: unknown) => value === undefined || typeof value === "string"

function asEvent(value: unknown): Event | undefined {
  if (!value || typeof value !== "object") return undefined
  const raw = value as { [key: string]: unknown }
  if (raw.v !== 1 || typeof raw.at !== "number" || !str(raw.id) || !str(raw.rootSession)) return undefined
  switch (raw.type) {
    case "recorded":
      return str(raw.session) &&
        str(raw.title) &&
        str(raw.action) &&
        (raw.by === "agent" || raw.by === "you") &&
        (raw.url !== undefined || raw.ref !== undefined) &&
        ["url", "ref", "kind", "for", "note", "sessionTitle", "subagent"].every((field) => optStr(raw[field]))
        ? (raw as unknown as Event)
        : undefined
    case "removed":
      return str(raw.record) ? (raw as unknown as Event) : undefined
    case "deleted":
      return optStr(raw.sessionTitle) ? (raw as unknown as Event) : undefined
    default:
      return undefined
  }
}

function parseLine(line: string): Event | undefined {
  try {
    return asEvent(JSON.parse(line))
  } catch {
    /**
     * A writer that died mid-line leaves no newline, so the next event is appended onto the remains:
     * `{"v":1,"at":17…{"v":1,"at":18…}`. The last event start in the line is the whole one.
     */
    const at = line.lastIndexOf('{"v":1')
    if (at <= 0) return undefined
    try {
      return asEvent(JSON.parse(line.slice(at)))
    } catch {
      return undefined
    }
  }
}

/**
 * Events in `text`, and what is left after the last newline. The rest is not an error: it is a line
 * another window is still writing, read again next time.
 */
export function parseLines(text: string): { events: Event[]; rest: string } {
  const end = text.lastIndexOf("\n")
  const whole = end < 0 ? "" : text.slice(0, end)
  const rest = end < 0 ? text : text.slice(end + 1)
  const events: Event[] = []
  for (const line of whole.split("\n")) {
    if (line.trim() === "") continue
    const event = parseLine(line)
    if (event) events.push(event)
  }
  return { events, rest }
}

/** One line of the file. Never contains a newline, whatever a title holds. */
export const serialize = (event: Event): string => `${JSON.stringify(event)}\n`
