/**
 * The ledger: what happened, one event per line, and what it adds up to.
 *
 * Append-only on purpose. Several OpenCode windows on one project write to the same file, and a
 * whole line appended in one write is the only update that needs no lock: nothing is ever rewritten,
 * so no window can undo another's. The state is never stored — it is a fold over the events, so it
 * cannot drift from them, and a rule's history ("approved 3×, rejected once, approved again") is
 * there to read rather than summarised away.
 *
 * Reading is forgiving in exactly one way: a line cut short by a crash is skipped, and a line written
 * after it (which then starts mid-line) is recovered. Anything else that does not parse is ignored —
 * a ledger you edited by hand should cost you a rule, not the bay.
 */

import { familyOf, notReadSubject } from "./family.ts"
import { canonical } from "./rules.ts"

export interface Item {
  subject: string
  danger?: string
  /** On an answer by Trust: the widened family that answered it, rather than the rule's own count. */
  via?: string
  /** `via` is a family Trust learned (reads only), not one a person widened. */
  learned?: true
}

/** What every event about one request carries. */
interface About {
  request: string
  session: string
  /** The tool call that asked: what a later surface needs to mark the call answered by Trust. */
  call?: string
  permission: string
  agent: string
  items: Item[]
}

export type Event = { v: 1; at: number } & (
  | ({ type: "asked"; why?: string } & About)
  /** A person approved it (a reply too fast for a person is never recorded as one). */
  | ({ type: "approved"; always?: string[] } & About)
  | ({ type: "rejected" } & About)
  /** Trust approved it; `rule` says why, in words. */
  | ({ type: "auto"; rule: string } & About)
  /** You took a rule's trust away; it has to be earned again. */
  | { type: "revoked"; permission: string; agent: string; subject: string }
  /**
   * You trusted a whole family (family.ts) in this project: any command in it is answered, except the
   * ones a widening never covers. Only a person writes this. (Trust learns a family of plain reads by
   * itself — `Widened.learned` — but that is a fold of approvals, never an event.)
   */
  | { type: "widened"; permission: string; agent: string; family: string }
  /** The family is back to its exact rules, each standing on its own count. */
  | { type: "unwidened"; permission: string; agent: string; family: string }
  /** You said no to Trust's suggestion to widen this family (suggest.ts): it is not suggested again. */
  | { type: "dismissed"; permission: string; agent: string; family: string }
  /** Trust stops answering in this project until resumed — every window, not just this one. */
  | { type: "paused" }
  | { type: "resumed" }
)

/** One subject's standing, under one permission and one agent. */
export interface Entry {
  key: string
  permission: string
  agent: string
  subject: string
  /** Why it costs more, as of the last time it was asked. */
  danger?: string
  /** Approvals by a person in a row since the last reject, revoke or expiry. */
  streak: number
  /** Every approval by a person, ever. */
  approvals: number
  /** Every answer by Trust, ever. */
  autos: number
  firstAt: number
  /** Last approved or answered: what expiry counts from. */
  lastAt: number
  rejectedAt?: number
  revokedAt?: number
}

/** An "always" a person gave OpenCode itself: broader than it looks, and gone when OpenCode stops. */
export interface Always {
  at: number
  session: string
  permission: string
  agent: string
  patterns: string[]
}

/** A family trusted as a whole in this project, under one permission. `agent`: who asked, or `ANY_AGENT`. */
export interface Widened {
  key: string
  permission: string
  agent: string
  family: string
  at: number
  /**
   * Trust learned it: `threshold` approvals in a row of plain reads in it (effect.ts). It covers
   * reads only — `head -3 a`, never `head .env` or `head a > b` — and lasts while it is used.
   */
  learned?: true
  /** A learned family's last approval or answer: what its expiry counts from. */
  lastAt?: number
}

/** Approvals in a row of plain reads in one family, towards learning it. */
export interface ReadStreak {
  streak: number
  lastAt: number
}

export interface State {
  entries: Map<string, Entry>
  /** By `keyOf(permission, family)`: the same key shape as a rule, a different namespace. */
  widened: Map<string, Widened>
  /** By the same key as `widened`: reads approved in a row per family, towards a learned family. */
  reads: Map<string, ReadStreak>
  /** Families not to suggest widening again, by the same key: dismissed, or widened and undone. */
  dismissed: Set<string>
  always: Always[]
  paused: boolean
  /** Requests already settled: two windows writing one outcome count it once. */
  settled: Set<string>
}

export interface FoldOptions {
  /** Unused this long, trust starts again from nothing. 0 never expires. */
  expireMs: number
  /** Reads approved in a row that teach Trust their family. Absent: no family is learned. */
  threshold?: number
}

export const DAY = 86_400_000

export const emptyState = (): State => ({
  entries: new Map(),
  widened: new Map(),
  reads: new Map(),
  dismissed: new Set(),
  always: [],
  paused: false,
  settled: new Set(),
})

/**
 * A rule's key: what was asked, under which permission — and nothing about who asked. Trust is a
 * project's: you give permission for the work in a project, so `ls` approved while `build` ran is
 * `ls` for `general` and every subagent too. The agent stays on every event, for the history.
 */
export const keyOf = (permission: string, subject: string): string =>
  JSON.stringify([canonical(permission), subject])

/**
 * The agent a person's own act is written with — a widening, a revoke, a dismissal: it is for the
 * project, not for whoever happened to ask. A ledger from before 0.11 names an agent there; it is
 * read the same, since no key carries one.
 */
export const ANY_AGENT = "*"

function entry(state: State, permission: string, agent: string, item: Item, at: number): Entry {
  const key = keyOf(permission, item.subject)
  let found = state.entries.get(key)
  if (!found) {
    found = {
      key,
      permission: canonical(permission),
      agent,
      subject: item.subject,
      streak: 0,
      approvals: 0,
      autos: 0,
      firstAt: at,
      lastAt: at,
    }
    state.entries.set(key, found)
  }
  /** Who asked it last: for the history, never for a decision. */
  found.agent = agent
  if (item.danger) found.danger = item.danger
  else delete found.danger
  return found
}

const expired = (found: Entry, at: number, options: FoldOptions) =>
  options.expireMs > 0 && found.lastAt > 0 && at - found.lastAt > options.expireMs

export function apply(state: State, event: Event, options: FoldOptions): State {
  switch (event.type) {
    case "asked":
      return state
    case "approved":
    case "rejected":
    case "auto": {
      if (state.settled.has(event.request)) return state
      state.settled.add(event.request)
      learn(state, event, options)
      for (const item of event.items) {
        const found = entry(state, event.permission, event.agent, item, event.at)
        if (event.type === "rejected") {
          found.streak = 0
          found.rejectedAt = event.at
          continue
        }
        if (expired(found, event.at, options)) found.streak = 0
        if (event.type === "approved") {
          found.streak++
          found.approvals++
        } else found.autos++
        found.lastAt = Math.max(found.lastAt, event.at)
      }
      if (event.type === "approved" && event.always?.length)
        state.always.push({
          at: event.at,
          session: event.session,
          permission: canonical(event.permission),
          agent: event.agent,
          patterns: event.always,
        })
      return state
    }
    case "revoked": {
      const found = state.entries.get(keyOf(event.permission, event.subject))
      if (found) {
        found.streak = 0
        found.revokedAt = event.at
      }
      return state
    }
    case "widened": {
      const key = keyOf(event.permission, event.family)
      state.widened.set(key, {
        key,
        permission: canonical(event.permission),
        agent: event.agent,
        family: event.family,
        at: event.at,
      })
      return state
    }
    case "unwidened": {
      /** A learned family taken away starts again from nothing, as a revoked rule does. */
      const key = keyOf(event.permission, event.family)
      state.widened.delete(key)
      state.reads.delete(key)
      /** A suggestion was answered once: undoing what it led to is not a reason to ask again. */
      state.dismissed.add(key)
      return state
    }
    case "dismissed":
      state.dismissed.add(keyOf(event.permission, event.family))
      return state
    case "paused":
      state.paused = true
      return state
    case "resumed":
      state.paused = false
      return state
  }
}

/**
 * A request's part in learning families of reads. Each family counts once per request, so
 * `head a | head b` is one approval of `head`. A reject of a read in a family starts it over and
 * takes a learned family away; a reject of something it never covers (`head .env`) leaves it.
 */
function learn(
  state: State,
  event: Extract<Event, { type: "approved" | "rejected" | "auto" }>,
  options: FoldOptions,
): void {
  if (options.threshold === undefined) return
  const seen = new Set<string>()
  for (const item of event.items) {
    const key = keyOf(event.permission, familyOf(event.permission, item.subject))
    let learned = state.widened.get(key)
    /** Unused too long, a learned family is gone, and has to be learned again from nothing. */
    if (
      learned?.learned &&
      options.expireMs > 0 &&
      event.at - (learned.lastAt ?? learned.at) > options.expireMs
    ) {
      state.widened.delete(key)
      state.reads.delete(key)
      learned = undefined
    }
    if (event.type === "rejected") {
      /**
       * Only a no to something learning would answer counts against it: rejecting `head .env` says
       * nothing about `head README.md`, which is all a learned `head` ever covers.
       */
      if (notReadSubject(event.permission, item.subject) !== undefined) continue
      state.reads.delete(key)
      if (learned?.learned) state.widened.delete(key)
      continue
    }
    if (event.type === "auto") {
      if (learned?.learned && item.via !== undefined) learned.lastAt = Math.max(learned.lastAt ?? 0, event.at)
      continue
    }
    if (item.danger || notReadSubject(event.permission, item.subject) !== undefined) continue
    /** Counted once per request, by its first read: `head .env | head a` counts `head a`. */
    if (seen.has(key)) continue
    seen.add(key)
    const found = state.reads.get(key) ?? { streak: 0, lastAt: event.at }
    if (options.expireMs > 0 && event.at - found.lastAt > options.expireMs) found.streak = 0
    found.streak++
    found.lastAt = Math.max(found.lastAt, event.at)
    state.reads.set(key, found)
    if (learned?.learned) learned.lastAt = Math.max(learned.lastAt ?? 0, event.at)
    else if (!learned && found.streak >= options.threshold) {
      const family = familyOf(event.permission, item.subject)
      state.widened.set(key, {
        key,
        permission: canonical(event.permission),
        agent: event.agent,
        family,
        at: event.at,
        learned: true,
        lastAt: event.at,
      })
    }
  }
}

export function applyAll(state: State, events: readonly Event[], options: FoldOptions): State {
  for (const event of events) apply(state, event, options)
  return state
}

/* ─── standing ───────────────────────────────────────────────────────────────────────────────── */

export interface Thresholds {
  threshold: number
  dangerExtra: number
  expireDays: number
}

export interface Standing {
  /** Approvals in a row that still count. */
  have: number
  need: number
  trusted: boolean
  expired: boolean
}

/** A widening answers now: one a person made always; a learned one until it goes unused too long. */
export const live = (widened: Widened, settings: Thresholds, now: number): boolean =>
  !widened.learned ||
  settings.expireDays <= 0 ||
  now - (widened.lastAt ?? widened.at) <= settings.expireDays * DAY

export function needFor(danger: string | undefined, settings: Thresholds): number {
  return settings.threshold + (danger ? settings.dangerExtra : 0)
}

/** Where a subject stands now. `danger` is today's reading, which wins over the one stored. */
export function standing(
  found: Entry | undefined,
  danger: string | undefined,
  settings: Thresholds,
  now: number,
): Standing {
  const need = needFor(danger, settings)
  if (!found) return { have: 0, need, trusted: false, expired: false }
  const gone = settings.expireDays > 0 && now - found.lastAt > settings.expireDays * DAY
  const have = gone ? 0 : found.streak
  return { have, need, trusted: have >= need, expired: gone }
}

/* ─── the file ───────────────────────────────────────────────────────────────────────────────── */

const TYPES = new Set([
  "asked",
  "approved",
  "rejected",
  "auto",
  "revoked",
  "widened",
  "unwidened",
  "dismissed",
  "paused",
  "resumed",
])

function asEvent(value: unknown): Event | undefined {
  if (!value || typeof value !== "object") return undefined
  const raw = value as Record<string, unknown>
  if (raw.v !== 1 || typeof raw.at !== "number" || typeof raw.type !== "string" || !TYPES.has(raw.type))
    return undefined
  if (raw.type === "revoked")
    return typeof raw.permission === "string" &&
      typeof raw.agent === "string" &&
      typeof raw.subject === "string"
      ? (raw as Event)
      : undefined
  if (raw.type === "widened" || raw.type === "unwidened" || raw.type === "dismissed")
    return typeof raw.permission === "string" &&
      typeof raw.agent === "string" &&
      typeof raw.family === "string"
      ? (raw as Event)
      : undefined
  if (raw.type === "paused" || raw.type === "resumed") return raw as Event
  if (
    typeof raw.request !== "string" ||
    typeof raw.permission !== "string" ||
    typeof raw.agent !== "string" ||
    !Array.isArray(raw.items) ||
    !raw.items.every((item) => item && typeof (item as Item).subject === "string")
  )
    return undefined
  return raw as Event
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

/** One line of the file. Never contains a newline, whatever a subject holds. */
export const serialize = (event: Event): string => `${JSON.stringify(event)}\n`
