/**
 * Messaging a subagent from its pane: the box at the foot is always there, as OpenCode's own prompt
 * is. `tab` or a click on it puts the keys into it; enter sends and leaves you typing, as OpenCode's
 * prompt does; esc (or `tab`) hands the keys back to the pane and keeps what you typed. A paste goes
 * in too. A finished subagent's answer goes nowhere on its own, so once it has answered, what you
 * asked and what it said are relayed to the main agent.
 */

import type { Host } from "@opencode-cockpit/client/host"
import { onPaste } from "@opencode-cockpit/client/host"
import type { Log } from "@opencode-cockpit/client/log"
import { type Model, type Session, titleOf } from "../core/model/model.ts"
import type { Source } from "./source.ts"
import type { Surface } from "./surface.ts"

/** Messages you sent, as `<session>:<text>` — so the pane can tell yours from the main agent's. */
export const YOURS_KEY = "cockpit.subagents.yours"
const YOURS_MAX = 200
/** How much of an answer is relayed to the main agent. */
const RELAY_MAX = 4000
const clip = (text: string, most: number) => (text.length > most ? `${text.slice(0, most - 1)}…` : text)

export interface Messages {
  /** `tab`, or a click on the box: keys go into the message to the subagent open in the pane. */
  focus(): void
  /** Keys go back to the pane; the draft stays in the box. */
  blur(): void
  /** A subagent went idle: if you had asked it something, its answer goes to the main agent. */
  relay(id: string): void
}

export function createMessages(input: {
  api: Host
  log: Log
  model: Model
  surface: Surface
  yours: Set<string>
  feed: () => Source
  opened: () => Session | undefined
  busy: (session: Session) => boolean
  draw: () => void
  set: (change: Partial<Surface>) => void
}): Messages {
  const { api, log, model, surface, yours, opened, busy, draw, set } = input

  const focus = () => {
    if (!opened()) return
    surface.typing = true
    surface.notice = undefined
    log.debug("message: typing", { id: surface.open })
    draw()
  }

  const blur = () => {
    if (!surface.typing) return
    surface.typing = false
    draw()
  }

  /** `text` in at the cursor, which moves past it. */
  const insert = (text: string) => {
    const draft = surface.draft ?? ""
    const caret = Math.min(draft.length, surface.caret ?? draft.length)
    surface.draft = draft.slice(0, caret) + text + draft.slice(caret)
    surface.caret = caret + text.length
  }

  /**
   * Messages you sent a finished subagent, until it answers. Its answer goes nowhere on its own — the
   * main agent's task returned long ago — so once it is idle again, what you asked and what it said
   * are added to the main conversation, quietly: no turn starts, and the main agent knows next time.
   */
  const asked = new Map<string, { question: string; busy: boolean }>()
  /** How long a subagent that went idle is given to start a run of its own for a queued message. */
  const SETTLE_MS = 3000

  /** The entries after your message: what the subagent did with it, if anything. */
  const after = (id: string, question: string) => {
    const entries = model.sessions.get(id)?.entries ?? []
    const at = entries.findLastIndex((entry) => entry.kind === "prompt" && entry.text === question)
    return at < 0 ? [] : entries.slice(at + 1)
  }

  const relay = (id: string) => {
    if (!asked.has(id)) return
    /**
     * Settled first: sent while it was busy, OpenCode 1 may queue the message and start a run for it
     * straight after — or finish without reading it at all, which happened: the message sat in the
     * run as "Round 3" and nothing answered it.
     */
    setTimeout(() => {
      const pending = asked.get(id)
      const session = model.sessions.get(id)
      if (!pending || !session) return
      if (busy(session) || session.status === "waiting") {
        /** A run of its own for the message: its answer goes nowhere unless it is relayed. */
        pending.busy = false
        return
      }
      asked.delete(id)
      const followed = after(id, pending.question)
      if (!followed.some((entry) => entry.kind !== "prompt")) {
        log.warn("message not answered", { id })
        if (surface.open === id && !surface.draft)
          set({
            draft: pending.question,
            caret: undefined,
            typing: true,
            notice: `${session.agent} finished without reading your message — enter sends it again, ctrl+u clears it.`,
          })
        return
      }
      /** Read inside a run the main agent was waiting on: its answer already went there. */
      if (pending.busy || !session.parentID) return
      const answer = followed
        .filter((entry): entry is Extract<typeof entry, { kind: "reply" }> => entry.kind === "reply")
        .map((entry) => entry.text.trim())
        .filter(Boolean)
        .join("\n\n")
      const parent = model.sessions.get(session.parentID)
      const how = api.v1 ? "task_id" : "sessionID"
      const text = [
        "[Cockpit notification — information, not a request. Nothing to do unless the user asks.]",
        `The user messaged your ${session.agent} subagent "${titleOf(session)}" (${how} ${id}) directly.`,
        `They asked: ${pending.question}`,
        session.status === "failed"
          ? `It failed: ${session.error ?? "no reason given"}`
          : `It answered: ${answer ? clip(answer, RELAY_MAX) : "(nothing)"}`,
      ].join("\n")
      input
        .feed()
        .quiet(session.parentID, text, parent && parent.agent !== "agent" ? parent.agent : undefined)
        .then(() => {
          log.info("relayed to the main agent", { id, parent: session.parentID })
          if (surface.open === id)
            set({ notice: `The main agent now knows what ${session.agent} answered you.` })
        })
        .catch((error) => log.warn("relay failed", { id, error }))
    }, SETTLE_MS)
  }

  const sendMessage = () => {
    const session = opened()
    const text = surface.draft?.trim()
    surface.draft = undefined
    surface.caret = undefined
    if (!session || !text) return draw()
    /** Taken now: the model may learn something about the session before the call returns. */
    const { id, agent } = session
    const wasBusy = busy(session)
    yours.add(`${id}:${text}`)
    api.kv.set(YOURS_KEY, [...yours].slice(-YOURS_MAX))
    /** Working, it answers the main agent itself; finished, its answer is relayed once it comes. */
    /** Watched either way: answered in a run of its own, it is relayed; not answered, it comes back. */
    asked.set(id, { question: text, busy: wasBusy })
    surface.notice = `Sending to ${agent}…`
    surface.top = undefined
    draw()
    input
      .feed()
      .send(id, text, wasBusy, agent)
      .then(() => {
        log.info("message sent", { id, agent, busy: wasBusy })
        surface.notice = `Sent to ${agent}.`
      })
      .catch((error) => {
        log.error("message failed", { id, error })
        surface.notice = `Not sent: ${error instanceof Error ? error.message : String(error)}`
      })
      .finally(draw)
  }

  /** A paste while typing goes into the message — one line, as the field is. */
  const offPaste = onPaste(api, (text) => {
    if (!surface.open || !surface.typing) return false
    insert(text.replace(/\r?\n/g, " "))
    log.debug("message: pasted", { chars: text.length })
    draw()
    return true
  })
  api.lifecycle.onDispose(offPaste)

  /**
   * Typing takes every key before the layer, so `e`, `t`, `j`… go into the words — and `y` into a
   * word rather than answering a permission card: the card's keys are the pane's, not the box's.
   */
  api.keymap.intercept(
    (ctx) => {
      if (!surface.open || !surface.typing) return
      const event = ctx.event
      ctx.consume({ preventDefault: true, stopPropagation: true })
      const draft = surface.draft ?? ""
      const caret = Math.min(draft.length, surface.caret ?? draft.length)
      if (event.name === "escape" || event.name === "tab") return blur()
      if (event.name === "return" || event.name === "enter") return sendMessage()
      if (event.name === "backspace") {
        surface.draft = draft.slice(0, Math.max(0, caret - 1)) + draft.slice(caret)
        surface.caret = Math.max(0, caret - 1)
      } else if (event.name === "left") surface.caret = Math.max(0, caret - 1)
      else if (event.name === "right") surface.caret = Math.min(draft.length, caret + 1)
      else if (event.ctrl && event.name === "u") {
        /** The readline key OpenCode's prompt keeps too: what is before the cursor goes. */
        surface.draft = draft.slice(caret)
        surface.caret = 0
      } else if (event.sequence && !event.ctrl && !event.meta && event.sequence >= " ") insert(event.sequence)
      draw()
    },
    { priority: 10_000 },
  )

  return { focus, blur, relay }
}
