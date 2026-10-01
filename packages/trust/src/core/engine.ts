/**
 * Trust in one window: the requests it is watching, the replies it sent, and the events each turn
 * of that produces. No clock, no file, no OpenCode — times are passed in, events are handed back to
 * be written, and the file's events (this window's and every other's) come back in through `load`.
 *
 * That last loop is deliberate. An event this window writes is applied when it is read back from the
 * file, in the file's order, exactly like another window's: the state is one fold over one sequence,
 * never a fold of "ours" patched with "theirs".
 *
 * **Who answered.** `permission.replied` does not say (docs/opencode/permissions.md), so:
 * our own replies are known by request id; a reply under `PERSON_MS` after the request is not a
 * person — OpenCode's `--auto` answers in 15–22ms, a person in a second or more — and is not counted;
 * a request asked before this window was watching has no time to measure, and is not counted either.
 * Every doubt under-counts a person, never over-counts one. A reject always counts: resetting is the
 * safe direction.
 */

import type { Context, Request } from "./keys.ts"
import { applyAll, type Event, emptyState, type FoldOptions, type State, type Thresholds } from "./ledger.ts"
import { decide, type Judgement } from "./policy.ts"
import type { ConfigRule } from "./rules.ts"

/** Faster than this, nobody read the prompt. Measured: auto mode 15–22ms, a person 1.2s and up. */
export const PERSON_MS = 300

/** How long a request must have been pending before the host's list may say it is gone. */
export const RECONCILE_AFTER_MS = 10_000

export type Reply = "once" | "always" | "reject"

export type Credit =
  | { kind: "approved"; always?: string[] }
  | { kind: "rejected" }
  | { kind: "ignored"; why: string }

/** Whose reply this was, as far as can be known — and so what it counts for. */
export function credit(input: {
  reply: Reply
  /** When the request was asked; undefined when this window never saw it asked. */
  askedAt?: number
  repliedAt: number
  /** This window answered it. */
  ours: boolean
  always?: string[]
}): Credit {
  if (input.ours) return { kind: "ignored", why: "answered by Trust" }
  if (input.reply === "reject") return { kind: "rejected" }
  if (input.askedAt === undefined) return { kind: "ignored", why: "asked before Trust was watching" }
  const took = input.repliedAt - input.askedAt
  if (took < PERSON_MS) return { kind: "ignored", why: `answered in ${took}ms — not a person` }
  return input.reply === "always" && input.always?.length
    ? { kind: "approved", always: input.always }
    : { kind: "approved" }
}

export interface Pending {
  request: Request
  agent: string
  askedAt: number
  judgement: Judgement
}

/** One answer Trust gave, for the sidebar's list. */
export interface Answered {
  at: number
  request: string
  permission: string
  agent: string
  /** The subjects, as one line: `git status`, or `git add -A && git commit -m wip`. */
  label: string
  subjects: string[]
  why: string
}

export interface EngineOptions extends Thresholds {
  /** Answers by Trust kept for the sidebar. */
  keep?: number
}

export interface Engine {
  readonly state: State
  /** Events read from the ledger file, in file order. */
  load(events: readonly Event[], options?: { reset?: boolean }): void
  /**
   * A request was asked. Returns the judgement and the `asked` event to write; when the judgement is
   * to answer, the request is marked ours *before* the reply is sent, so the `replied` it causes is
   * never mistaken for a person's.
   */
  ask(input: {
    request: Request
    context: Context
    agent: string
    rules: readonly ConfigRule[]
    at: number
  }): { judgement: Judgement; event: Event }
  /** Our reply went through: the `auto` event to write. */
  answered(requestID: string, at: number): Event | undefined
  /** Our reply failed: the request is the person's again, and their answer counts. */
  failed(requestID: string): void
  /** A reply arrived — ours, OpenCode's, a person's. The events to write, and what it was taken for. */
  replied(input: { requestID: string; reply: Reply; at: number }): { events: Event[]; credit: Credit }
  /** Requests the host says are no longer pending: answered while we were not looking. */
  reconcile(stillPending: ReadonlySet<string>, now: number): void
  pending(): Pending[]
  /** Trust's answers in this window, newest first. */
  recent(): Answered[]
  /** How many answers Trust gave in this window. */
  count(): number
  reset(options: EngineOptions): void
}

export function createEngine(initial: EngineOptions): Engine {
  let options = initial
  const fold = (): FoldOptions => ({ expireMs: options.expireDays * 86_400_000 })
  let events: Event[] = []
  let state = emptyState()
  const pending = new Map<string, Pending>()
  /** Requests this window decided to answer, until the answer is recorded or fails. */
  const ours = new Map<string, Pending>()
  /**
   * Every request this window answered, kept after the answer is recorded: the reply our answer causes
   * can arrive before or after our call returns, and either way it is ours.
   */
  const mine = new Set<string>()
  const answered: Answered[] = []
  let total = 0

  const about = (entry: Pending) => ({
    request: entry.request.id,
    session: entry.request.sessionID,
    ...(entry.request.call ? { call: entry.request.call } : {}),
    permission: entry.request.permission,
    agent: entry.agent,
    items: entry.judgement.items,
  })

  return {
    get state() {
      return state
    },
    load(more, { reset = false } = {}) {
      if (reset) {
        events = []
        state = emptyState()
      }
      events = events.concat(more)
      applyAll(state, more, fold())
    },
    ask({ request, context, agent, rules, at }) {
      const judgement = decide({ request, context, agent, rules, state, settings: options, now: at })
      const entry: Pending = { request, agent, askedAt: at, judgement }
      pending.set(request.id, entry)
      if (judgement.answer) {
        ours.set(request.id, entry)
        mine.add(request.id)
        if (mine.size > 500) mine.delete(mine.values().next().value as string)
      }
      return { judgement, event: { v: 1, at, type: "asked", why: judgement.why, ...about(entry) } }
    },
    answered(requestID, at) {
      const entry = ours.get(requestID)
      if (!entry) return undefined
      ours.delete(requestID)
      pending.delete(requestID)
      total++
      const subjects = entry.judgement.items.map((item) => item.subject)
      answered.unshift({
        at,
        request: requestID,
        permission: entry.request.permission,
        agent: entry.agent,
        label: subjects.join(" && "),
        subjects,
        why: entry.judgement.why,
      })
      answered.splice(Math.max(1, options.keep ?? 20))
      return { v: 1, at, type: "auto", rule: entry.judgement.why, ...about(entry) }
    },
    failed(requestID) {
      ours.delete(requestID)
      mine.delete(requestID)
    },
    replied({ requestID, reply, at }) {
      const entry = pending.get(requestID)
      pending.delete(requestID)
      const given = credit({
        reply,
        ...(entry ? { askedAt: entry.askedAt, always: entry.request.always } : {}),
        repliedAt: at,
        ours: mine.has(requestID),
      })
      if (!entry || given.kind === "ignored") return { events: [], credit: given }
      /** Nothing to count — unless it was an "always", which the ledger shows whatever it covered. */
      const always = given.kind === "approved" && given.always !== undefined
      if (entry.judgement.items.length === 0 && !always) return { events: [], credit: given }
      if (given.kind === "rejected")
        return { events: [{ v: 1, at, type: "rejected", ...about(entry) }], credit: given }
      return {
        events: [
          { v: 1, at, type: "approved", ...(given.always ? { always: given.always } : {}), ...about(entry) },
        ],
        credit: given,
      }
    },
    reconcile(stillPending, now) {
      for (const [id, entry] of [...pending]) {
        if (stillPending.has(id) || ours.has(id)) continue
        /** A list is a moment, and events lag it: a request this young may simply not be in it yet. */
        if (now - entry.askedAt < RECONCILE_AFTER_MS) continue
        pending.delete(id)
      }
    },
    pending: () => [...pending.values()],
    recent: () => answered,
    count: () => total,
    reset(next) {
      options = next
      state = applyAll(emptyState(), events, fold())
    },
  }
}
