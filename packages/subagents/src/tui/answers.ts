/**
 * Answering a permission from the pane: the card at its foot (core/view/foot.ts) offers the first
 * request the open subagent is held on, and `y`, `Y`, `n` or a click answer it through the host —
 * the same request OpenCode's own prompt shows, so that prompt goes as well. Before this, a subagent
 * that asked while you watched it had to be closed to be answered.
 *
 * An answer is taken as given the moment it is sent: the card moves on to the next request, or
 * goes. If the host refuses it, the request comes back with what the host said, to be answered again.
 */

import type { Log } from "@opencode-cockpit/client/log"
import type { Model, Permission, Session } from "../core/model/model.ts"
import type { Decision, Source } from "./source.ts"
import type { Surface } from "./surface.ts"

/** What the card offers: the requests not already answered from here, and why the last answer failed. */
export function cardOf(
  session: Session,
  replies: Surface["replies"],
): { pending: Permission[]; error?: string } {
  const pending = session.pending.filter((ask) => {
    const reply = replies.get(ask.id)
    return !reply || reply.error !== undefined
  })
  const error = pending[0] ? replies.get(pending[0].id)?.error : undefined
  return { pending, ...(error ? { error } : {}) }
}

export interface Answers {
  /** Answers the card's request for the subagent open in the pane; nothing when it has none. */
  reply(decision: Decision): void
}

export function createAnswers(input: {
  log: Log
  model: Model
  surface: Surface
  feed: () => Source
  opened: () => Session | undefined
  draw: () => void
}): Answers {
  const { log, model, surface, opened, draw } = input

  /** Answers the host has since heard of — by anyone — are forgotten, so the map stays small. */
  const forget = () => {
    const asked = new Set<string>()
    for (const session of model.sessions.values()) for (const ask of session.pending) asked.add(ask.id)
    for (const id of surface.replies.keys()) if (!asked.has(id)) surface.replies.delete(id)
  }

  const reply = (decision: Decision) => {
    const session = opened()
    const ask = session ? cardOf(session, surface.replies).pending[0] : undefined
    if (!session || !ask) return
    forget()
    surface.replies.set(ask.id, {})
    log.info("permission answered", { id: session.id, request: ask.id, permission: ask.permission, decision })
    draw()
    input
      .feed()
      .reply(ask, decision)
      .catch((error: unknown) => {
        log.warn("permission answer failed", { id: session.id, request: ask.id, error })
        surface.replies.set(ask.id, { error: error instanceof Error ? error.message : String(error) })
      })
      .finally(draw)
  }

  return { reply }
}
