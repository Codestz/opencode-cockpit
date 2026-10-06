/**
 * Requests: what OpenCode asks, decided and answered. A request is read as soon as it is seen, decided
 * by the engine against your rules, written to the ledger, and — when Trust answers — replied "once".
 * A reply you give is counted as one. `reconcile` picks up requests whose asking or answer was missed.
 */

import type { Host } from "@opencode-cockpit/client/host"
import type { Log } from "@opencode-cockpit/client/log"
import { commandOf, type Seen } from "../core/adapt/seen.ts"
import type { Engine } from "../core/engine.ts"
import type { Request } from "../core/keys.ts"
import type { Event } from "../core/ledger.ts"
import { rulesFrom } from "../core/rules.ts"
import type { Hasher } from "../core/secret.ts"
import type { Live } from "./paint.ts"
import { createSource } from "./source.ts"

/** How long a bash request waits for its call's command line before it is decided without one. */
const PARK_MS = 1_000
/** Calls remembered for their command line: far more than can be waiting at once. */
const CALLS_MAX = 500

export interface Requests {
  /** OpenCode's config, read again: the rules Trust decides with. */
  loadRules(): Promise<void>
  /** Whether the rules could be read; without them Trust answers nothing. */
  rulesReady(): boolean
  /** Requests already waiting, and any the events never said were answered; `adopt` decides them. */
  reconcile(adopt: boolean): Promise<void>
  dispose(): void
}

export function createRequests(input: {
  api: Host
  log: Log
  engine: Engine
  directory: string
  /** Secrets in a signature are hashed with this project's key (key.ts). */
  hash: Hasher
  live: Live
  write: (events: readonly Event[]) => void
  draw: () => void
}): Requests {
  const { api, log, engine, directory, hash, live, write, draw } = input
  /** OpenCode's config as its `config.get` returned it; undefined until read, and Trust stays out. */
  let opencodeConfig: unknown
  let rulesReady = false
  const calls = new Map<string, { line?: string; workdir?: string }>()
  const agents = new Map<string, string>()

  const loadRules = async () => {
    try {
      opencodeConfig = await feed.config()
      rulesReady = true
      if (live.trouble?.startsWith("OpenCode's config")) live.trouble = undefined
      log.debug("rules", { rules: rulesFrom(opencodeConfig).length })
    } catch (error) {
      /** Without the rules there is no knowing what you asked to be asked about: Trust stays out. */
      rulesReady = false
      log.error("config unreadable", { error })
      live.trouble = "OpenCode's config unreadable — not answering"
    }
    draw()
  }

  /**
   * Bash requests whose call has not said its command line yet, by call id. Measured on 1.18.32: the
   * call's `running` update — the one carrying `command` — arrived *after* `permission.asked` for
   * three requests in four (the first call of a turn was the exception). So a request without its
   * line waits for it, briefly; one that never gets it is decided without, which means asked.
   */
  const parked = new Map<string, { request: Request; at: number; timer: ReturnType<typeof setTimeout> }>()

  const lineOf = (request: Request) =>
    request.call ? (calls.get(request.call) ?? feed.call(request)) : undefined

  const asked = (request: Request, at: number) => {
    /**
     * Decided as soon as the request can be read, never after a file read: OpenCode's `--auto`
     * answers in 15–22ms, and a decision that waited on the disk could answer a request already gone.
     */
    if (!rulesReady) return
    const call = lineOf(request)
    if (
      request.permission === "bash" &&
      call?.line === undefined &&
      request.call &&
      !parked.has(request.call)
    ) {
      const key = request.call
      parked.set(key, { request, at, timer: setTimeout(() => unpark(key), PARK_MS) })
      return
    }
    decideNow(request, at, call)
  }

  /** The call's line arrived, a reply came first, or the wait ran out: decide with what is known. */
  const unpark = (key: string) => {
    const waiting = parked.get(key)
    if (!waiting) return
    parked.delete(key)
    clearTimeout(waiting.timer)
    if (!lineOf(waiting.request)) log.debug("no command line", { request: waiting.request.id, call: key })
    decideNow(waiting.request, waiting.at, lineOf(waiting.request))
  }

  const decideNow = (request: Request, at: number, call: ReturnType<typeof lineOf>) => {
    const agent =
      agents.get(request.sessionID) ?? feed.agent(request.sessionID, request.messageID) ?? "unknown"
    const { judgement, event } = engine.ask({
      request,
      context: { ...call, root: directory, hash },
      agent,
      rules: rulesFrom(opencodeConfig, agent),
      at,
    })
    log.debug("asked", { request: request.id, permission: request.permission, agent, why: judgement.why })
    write([event])
    draw()
    if (!judgement.answer) return
    feed
      .approve(request)
      .then(() => {
        const auto = engine.answered(request.id, Date.now())
        if (auto) write([auto])
        log.info("auto", {
          request: request.id,
          session: request.sessionID,
          call: request.call,
          permission: request.permission,
          agent,
          subjects: judgement.items.map((item) => item.subject),
          why: judgement.why,
          ms: Date.now() - at,
        })
        if (live.trouble?.startsWith("an answer failed")) live.trouble = undefined
        draw()
      })
      .catch((error) => {
        /** The prompt is still there and yours: your answer to it counts as any other. */
        engine.failed(request.id)
        log.warn("auto reply failed", { request: request.id, error })
        live.trouble = `an answer failed: ${error instanceof Error ? error.message : String(error)}`
        draw()
      })
  }

  const feed = createSource(api, log, (seen: Seen[]) => {
    const at = Date.now()
    for (const each of seen) {
      switch (each.type) {
        case "call": {
          calls.set(each.call, commandOf(each.input))
          if (calls.size > CALLS_MAX) calls.delete(calls.keys().next().value as string)
          if (parked.has(each.call) && calls.get(each.call)?.line !== undefined) unpark(each.call)
          break
        }
        case "agent":
          agents.set(each.sessionID, each.agent)
          break
        case "config":
          void loadRules()
          break
        case "asked":
          asked(each.request, at)
          break
        case "replied": {
          /** Answered while it waited for its line: decided first, so the answer counts against it. */
          for (const [key, waiting] of parked) if (waiting.request.id === each.requestID) unpark(key)
          const { events, credit } = engine.replied({ requestID: each.requestID, reply: each.reply, at })
          if (credit.kind === "ignored")
            log.debug("reply not counted", { request: each.requestID, why: credit.why })
          write(events)
          draw()
          break
        }
      }
    }
  })

  /** Requests already waiting when Trust started, and any the events never told us were answered. */
  const reconcile = async (adopt: boolean) => {
    const listed = await feed.pending().catch((error) => {
      log.debug("pending list failed", { error })
      return undefined
    })
    if (!listed) return
    const ids = new Set<string>()
    for (const each of listed) {
      if (each.type !== "asked") continue
      ids.add(each.request.id)
      /** Its asking was not seen, so "now" stands in for it: a person answers later still. */
      if (adopt) asked(each.request, Date.now())
    }
    engine.reconcile(ids, Date.now())
    draw()
  }

  return {
    loadRules,
    rulesReady: () => rulesReady,
    reconcile,
    dispose: () => {
      for (const waiting of parked.values()) clearTimeout(waiting.timer)
      parked.clear()
      feed.dispose()
    },
  }
}
