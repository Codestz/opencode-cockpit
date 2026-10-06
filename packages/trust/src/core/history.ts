/**
 * What happened, and when — read from the same events the state is folded from, for the screens
 * that say *why*: what Trust answered today, how the week went, and the approvals that earned a rule.
 *
 * The state (ledger.ts) keeps what a rule adds up to — a streak, a count, the last time — because
 * that is all a decision needs. A person asking "why is this trusted?" needs the moments themselves:
 * `✓ 9h  ✓ 9h  ✓ 9h → trusted`. So this is a second fold over the same sequence, beside the state and
 * never consulted by `decide`: nothing here changes what Trust answers.
 *
 * Bounded, because a ledger only grows: the last `MARKS` moments per rule (a run of answers is one
 * moment with a count, so a rule answered a thousand times does not push out the approvals that
 * earned it), the last `ANSWERS` answers, and a count of answers per day for the last `DAYS` days.
 * A rule older than its window still has its totals in the state; the screens fall back to those.
 */

import type { Event, Item } from "./ledger.ts"
import { keyOf } from "./ledger.ts"

/** One moment in a rule's life. A run of answers in a row is one mark, `count` of them. */
export type Mark =
  | { kind: "approved"; at: number }
  | { kind: "rejected"; at: number }
  | { kind: "revoked"; at: number }
  | { kind: "auto"; at: number; count: number }

/** One answer Trust gave, from any window on the project. */
export interface Answer {
  at: number
  request: string
  permission: string
  agent: string
  items: Item[]
  /** Why, as the window that answered put it (policy.ts). */
  rule: string
}

export interface History {
  /** By `keyOf(permission, subject)`, oldest first. */
  marks: Map<string, Mark[]>
  /** Oldest first, the last `ANSWERS`. */
  answers: Answer[]
  /** Answers per local day, by the day's first millisecond. */
  days: Map<number, number>
}

/** Moments kept per rule. */
export const MARKS = 24
/** Answers kept for the activity feed: far more than a screen lists. */
export const ANSWERS = 200
/** Days of answers counted: a week, and a week before it to spare. */
export const DAYS = 14

export const emptyHistory = (): History => ({ marks: new Map(), answers: [], days: new Map() })

/** The first millisecond of the local day `at` falls in. */
export function dayOf(at: number): number {
  const day = new Date(at)
  day.setHours(0, 0, 0, 0)
  return day.getTime()
}

function mark(history: History, key: string, next: Mark): void {
  let list = history.marks.get(key)
  if (!list) {
    list = []
    history.marks.set(key, list)
  }
  const last = list.at(-1)
  if (next.kind === "auto" && last?.kind === "auto") {
    last.count += next.count
    last.at = Math.max(last.at, next.at)
    return
  }
  list.push(next)
  if (list.length > MARKS) list.splice(0, list.length - MARKS)
}

/**
 * One event into the history. `settled` is the state's set of requests already counted, read before
 * the state applies this event: two windows writing one outcome are one moment here as there.
 */
export function note(history: History, event: Event, settled: ReadonlySet<string>): void {
  switch (event.type) {
    case "approved":
    case "rejected":
    case "auto": {
      if (settled.has(event.request)) return
      for (const item of event.items) {
        const key = keyOf(event.permission, item.subject)
        mark(
          history,
          key,
          event.type === "auto"
            ? { kind: "auto", at: event.at, count: 1 }
            : { kind: event.type, at: event.at },
        )
      }
      if (event.type !== "auto") return
      history.answers.push({
        at: event.at,
        request: event.request,
        permission: event.permission,
        agent: event.agent,
        items: event.items,
        rule: event.rule,
      })
      if (history.answers.length > ANSWERS) history.answers.splice(0, history.answers.length - ANSWERS)
      const day = dayOf(event.at)
      history.days.set(day, (history.days.get(day) ?? 0) + 1)
      if (history.days.size > DAYS) {
        const newest = Math.max(...history.days.keys())
        for (const each of history.days.keys())
          if (newest - each > DAYS * 86_400_000) history.days.delete(each)
      }
      return
    }
    case "revoked":
      mark(history, keyOf(event.permission, event.subject), { kind: "revoked", at: event.at })
      return
    default:
      return
  }
}

/* ─── reading it ─────────────────────────────────────────────────────────────────────────────── */

/** Answers newest first. */
export const latestAnswers = (history: History, limit = ANSWERS): Answer[] =>
  history.answers.slice(-limit).reverse()

/** Answers on each of the last `days` local days, the oldest first and today last. */
export function answersPerDay(history: History, now: number, days = 7): number[] {
  const out: number[] = []
  const today = dayOf(now)
  for (let back = days - 1; back >= 0; back--) {
    /** Noon of each day back, so a day with a clock change is still found by its own midnight. */
    const day = dayOf(today + 12 * 3_600_000 - back * 86_400_000)
    out.push(history.days.get(day) ?? 0)
  }
  return out
}

/** How a rule came to be trusted, read back from its moments. */
export interface Earned {
  /** Approvals in a row that count, as of `upTo`. */
  streak: number
  /** When the streak reached what it needed; undefined when it has not (or the window lost it). */
  since?: number
  /** The streak was broken by a reject or a revoke before it began: when. */
  brokenAt?: number
  broken?: "rejected" | "revoked" | "expired"
}

/**
 * The streak a rule's moments add up to, the way the state folds it (a reject or revoke starts it
 * over, an approval after `expireMs` unused starts it over) — and when it reached `need`.
 */
export function earned(
  marks: readonly Mark[],
  need: number,
  expireMs: number,
  upTo = Number.POSITIVE_INFINITY,
): Earned {
  let streak = 0
  let since: number | undefined
  let brokenAt: number | undefined
  let broken: Earned["broken"]
  let last = 0
  for (const each of marks) {
    if (each.at > upTo) break
    if (each.kind === "rejected" || each.kind === "revoked") {
      streak = 0
      since = undefined
      brokenAt = each.at
      broken = each.kind
      continue
    }
    if (expireMs > 0 && last > 0 && each.at - last > expireMs) {
      streak = 0
      since = undefined
      brokenAt = each.at
      broken = "expired"
    }
    last = Math.max(last, each.at)
    if (each.kind === "approved") {
      streak++
      if (streak === need) since = each.at
    }
  }
  return {
    streak,
    ...(since !== undefined ? { since } : {}),
    ...(brokenAt !== undefined ? { brokenAt } : {}),
    ...(broken !== undefined ? { broken } : {}),
  }
}
