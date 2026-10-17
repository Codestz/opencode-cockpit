/**
 * Trust's agent half: on OpenCode 2, a request answered before it is ever made.
 *
 * The interface answers on `permission.asked`, and by then OpenCode's prompt is on screen: for a
 * frame each time, and in a burst of parallel subagents a prompt that flickers and takes your typing.
 * OpenCode 2 lets a server plugin in earlier, at `Permission.evaluate` — after config's rules, before
 * any request exists (docs/opencode/permissions.md). Answered there, nothing is drawn at all.
 *
 * The decision is the interface's, made from the same pieces: the engine folded from the same ledger
 * (read again right before each decision, so an approval or a pause from any window counts), the
 * rules the interface last read (snapshot.ts — the agent side has no config to read), the same mask
 * key. What the request does not carry — a shell call's command line and working directory — comes
 * from the call itself, heard as it starts (`toolBefore`). Whenever a piece is missing or in doubt,
 * this half answers nothing and the request is asked as before, where the interface decides it again
 * with everything it can see. So a doubt here costs one frame of prompt, never a wrong answer.
 *
 * An answer is written to the ledger — `asked`, then `auto` — before OpenCode is told: the ledger is
 * the record, and an answer it could not record is not given. A request left to be asked writes
 * nothing here; the interface writes it when it sees it.
 */

import { randomBytes } from "node:crypto"
import type { Log } from "@opencode-cockpit/client/log"
import type { PermissionAsk, ToolStart } from "@opencode-cockpit/client/server"
import { commandOf, obj } from "../core/adapt/seen.ts"
import type { TrustSettings } from "../core/config.ts"
import { createEngine, type Engine } from "../core/engine.ts"
import type { Request } from "../core/keys.ts"
import type { TrustPaths } from "../core/paths.ts"
import { canonical, rulesFrom } from "../core/rules.ts"
import type { Hasher } from "../core/secret.ts"
import { createJournal } from "../tui/journal.ts"
import { type Snapshot, type SnapshotSettings, snapshotReader } from "../tui/snapshot.ts"

/** Calls remembered for their command line: far more than can be running at once. */
const CALLS_MAX = 500
/**
 * How long a decision may take, reading the ledger and writing to it, before the request is left to
 * be asked. The agent is waiting on it, so a slow disk costs a prompt, not a stalled turn.
 */
export const DECIDE_MS = 1_000
/**
 * Code Mode's outer call: it carries code, not a command, and the tools it runs come through again
 * under the same call id.
 */
const CODE_MODE = "execute"

export interface Answerer {
  /** A tool call starting: its command line kept by call id for the permission it may ask. */
  toolBefore(call: ToolStart): void
  /** "allow" when Trust answers for you; undefined leaves the request to be asked. */
  permission(request: PermissionAsk): Promise<"allow" | undefined>
}

interface Call {
  line?: string
  workdir?: string
  /** Two starts under one id — Code Mode's tools share their call's — so which line asked is unknown. */
  doubt?: true
  /** What has been decided for this call already, by action and resources. */
  decided: Set<string>
}

export function createAnswerer(input: {
  directory: string
  paths: TrustPaths
  /** This entry's own settings: used until the interface's snapshot says otherwise. */
  settings: TrustSettings
  hash: Hasher
  log: Log
  rules?: () => Promise<Snapshot | undefined>
  now?: () => number
  decideMs?: number
}): Answerer {
  const { directory, paths, hash, log, now = Date.now, decideMs = DECIDE_MS } = input
  const rules = input.rules ?? snapshotReader(paths)
  const journal = createJournal(paths)
  const thresholds = (from: SnapshotSettings) => ({
    threshold: from.threshold,
    dangerExtra: from.dangerExtra,
    expireDays: from.expireDays,
    learnReads: from.learnReads,
  })
  let using = JSON.stringify(thresholds(input.settings))
  const engine: Engine = createEngine({ ...thresholds(input.settings), keep: 1 })
  const calls = new Map<string, Call>()

  /** The interface's settings, when they differ from what the engine counts with. */
  const settle = (snapshot: Snapshot) => {
    const wanted = JSON.stringify(thresholds(snapshot.settings))
    if (wanted === using) return
    using = wanted
    engine.reset({ ...thresholds(snapshot.settings), keep: 1 })
  }

  const decide = async (request: PermissionAsk, call: Call, late: () => boolean) => {
    const snapshot = await rules()
    if (!snapshot) {
      log.debug("no rules from the interface; asking", { action: request.action })
      return undefined
    }
    settle(snapshot)
    const { events, reset } = await journal.read()
    engine.load(events, { reset })
    const agent = request.agent ?? "unknown"
    const at = now()
    const asked: Request = {
      /** No request exists yet: this id is Trust's own, and only the ledger ever holds it. */
      id: `trust_${randomBytes(9).toString("hex")}`,
      sessionID: request.sessionID,
      permission: canonical(request.action),
      patterns: request.resources,
      always: [],
      ...(request.callID ? { call: request.callID } : {}),
      ...(request.messageID ? { messageID: request.messageID } : {}),
    }
    const { judgement, event } = engine.ask({
      request: asked,
      context: {
        ...(call.line !== undefined ? { line: call.line } : {}),
        ...(call.workdir ? { workdir: call.workdir } : {}),
        root: directory,
        hash,
      },
      agent,
      rules: rulesFrom(snapshot.config, agent),
      at,
    })
    if (!judgement.answer) {
      engine.forget(asked.id)
      log.debug("left to ask", { action: request.action, agent, why: judgement.why })
      return undefined
    }
    const auto = engine.answered(asked.id, now())
    /** Past the deadline the request is already being asked: an answer written now would be false. */
    if (!auto || late()) return undefined
    try {
      await journal.append([event, auto])
    } catch (error) {
      log.warn("ledger not saved; asking", { file: paths.events, error })
      return undefined
    }
    log.info("auto", {
      request: asked.id,
      session: request.sessionID,
      call: request.callID,
      permission: asked.permission,
      agent,
      subjects: judgement.items.map((item) => item.subject),
      why: judgement.why,
      ms: now() - at,
    })
    return "allow" as const
  }

  return {
    toolBefore(start) {
      if (start.tool === CODE_MODE) return
      const known = calls.get(start.callID)
      if (known) {
        known.doubt = true
        return
      }
      calls.set(start.callID, { ...commandOf(obj(start.args)), decided: new Set() })
      if (calls.size > CALLS_MAX) calls.delete(calls.keys().next().value as string)
    },
    async permission(request) {
      /** Only a tool's request, from a call heard starting: anything else has nothing to decide with. */
      const call = request.callID ? calls.get(request.callID) : undefined
      if (!call || call.doubt) return undefined
      /**
       * Once per call and resources. OpenCode evaluates a waiting request again when you answer
       * another "always" — and that request is already on screen, the interface's to follow.
       */
      const key = JSON.stringify([request.action, request.resources])
      if (call.decided.has(key)) return undefined
      call.decided.add(key)
      if (canonical(request.action) === "bash" && call.line === undefined) return undefined
      let expired = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const deadline = new Promise<undefined>((done) => {
        timer = setTimeout(() => {
          expired = true
          done(undefined)
        }, decideMs)
      })
      try {
        return await Promise.race([decide(request, call, () => expired), deadline])
      } finally {
        clearTimeout(timer)
      }
    },
  }
}
