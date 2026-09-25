/**
 * Where subagents come from: the host's live events, and the stored runs of subagents that existed
 * before this plugin did. The only file that reaches past `Host` into a specific OpenCode — through
 * `api.v1` / `api.v2`, as Status's snapshot does — and every shape it reads was measured on 1.18.32
 * and 2.0.15 (docs/opencode/agents.md). Everything it learns becomes `Change`s for the model.
 */

import type { Host } from "@opencode-cockpit/client/host"
import type { Log } from "@opencode-cockpit/client/log"
import { createV1Translator } from "../core/adapt/v1.ts"
import { createV2Translator } from "../core/adapt/v2.ts"
import type { Change } from "../core/model/changes.ts"

export interface Source {
  /** Loads what exists under a conversation: its subagents, theirs, and their runs so far. */
  load: (root: string) => Promise<void>
  /**
   * Says something to a subagent; a busy one picks it up mid-run. `agent` is the subagent's own: sent
   * without one, OpenCode 1 answered as its default `build` agent — other tools, other permissions.
   */
  send: (id: string, text: string, busy: boolean, agent: string) => Promise<void>
  /**
   * Stops a subagent's run. Measured: on OpenCode 1 its task fails as "aborted" and the main agent
   * carries on; on OpenCode 2 it is interrupted, and the main agent may start it again.
   */
  stop: (id: string) => Promise<void>
  /**
   * Moves the subagents a conversation is blocked on into the background, so it carries on — what
   * OpenCode's own `ctrl+b` does. Measured: OpenCode 2 always; OpenCode 1 only when started with
   * OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true, and it says `false` otherwise. Resolves to
   * whether it happened.
   */
  background: (parentID: string) => Promise<boolean>
  /**
   * Tells a conversation something, as its user. Used before a stop: told nothing, the main agent
   * read the stopped subagent as failed and launched it again.
   */
  note: (sessionID: string, text: string, busy: boolean, agent?: string) => Promise<void>
  /** What the host says about a session now, for a run that went quiet; nothing when it does not know. */
  check: (id: string) => Change[]
  dispose: () => void
}

/** OpenCode 1 event types that concern sessions, messages and what they wait on. */
const V1_EVENTS = [
  "session.created",
  "session.updated",
  "session.status",
  "session.idle",
  "session.error",
  "message.updated",
  "message.part.updated",
  "message.part.delta",
  "permission.asked",
  "permission.replied",
  "question.asked",
  "question.replied",
  "question.rejected",
]

/**
 * The host's objects, reached by the shapes measured on real runs (docs/opencode/agents.md) rather than
 * by types: `api.v1` / `api.v2` are typed only as far as the host needs them.
 */
// biome-ignore lint/suspicious/noExplicitAny: see above — every access is to a measured field
type Loose = Record<string, any>

export function createSource(api: Host, log: Log, emit: (changes: Change[]) => void): Source {
  /** Each unexpected shape once, not once per event. */
  const told = new Set<string>()
  const unknown = (what: string, detail?: Record<string, unknown>) => {
    const key = `${what} ${JSON.stringify(detail)}`
    if (told.has(key)) return
    told.add(key)
    log.warn("unrecognised event", { what, ...detail })
  }
  const offs: (() => void)[] = []
  const guard = (where: string, fn: () => void) => {
    try {
      fn()
    } catch (error) {
      log.error(`${where} failed`, { error })
    }
  }

  if (api.v1) {
    const v1 = api.v1 as unknown as Loose
    const translate = createV1Translator(unknown)
    for (const type of V1_EVENTS) {
      const off = v1.event.on(type, (event: unknown) => guard("event", () => emit(translate.event(event))))
      if (typeof off === "function") offs.push(off)
    }
    return {
      async load(root) {
        const seen = new Set<string>()
        const visit = async (parent: string, depth: number): Promise<void> => {
          if (depth > 4 || seen.has(parent)) return
          seen.add(parent)
          const result = await v1.client.session.children({ sessionID: parent }).catch((error: unknown) => {
            log.warn("children failed", { parent, error })
            return undefined
          })
          const children: Loose[] = (result?.data ?? result ?? []) as Loose[]
          for (const child of Array.isArray(children) ? children : []) {
            const id = child.id as string
            const messages = (v1.state.session.messages(id) ?? []) as Loose[]
            const history = messages.map((info) => ({
              info,
              parts: (v1.state.part(info.id) ?? []) as unknown[],
            }))
            const status = v1.state.session.status(id) as Loose | undefined
            /**
             * Busy only when the host says so. A finished subagent is not in the host's status store at
             * all — reading "no status" as "unknown" left every old subagent running forever.
             */
            const busy = status?.type === "busy" || status?.type === "retry"
            emit([
              ...translate.session(child),
              ...translate.history(history),
              busy
                ? { type: "status", id, status: "busy", at: Date.now() }
                : { type: "status", id, status: "idle", at: Number(child.time?.updated) || Date.now() },
            ])
            await visit(id, depth + 1)
          }
        }
        await visit(root, 0)
      },
      async send(id, text, _busy, agent) {
        await v1.client.session.promptAsync({ sessionID: id, agent, parts: [{ type: "text", text }] })
      },
      async stop(id) {
        await v1.client.session.abort({ sessionID: id })
      },
      async background(parentID) {
        const result = await v1.client.experimental.session.background({ sessionID: parentID })
        return (result?.data ?? result) === true
      },
      async note(sessionID, text, _busy, agent) {
        await v1.client.session.promptAsync({
          sessionID,
          ...(agent ? { agent } : {}),
          parts: [{ type: "text", text }],
        })
      },
      check(id) {
        const status = v1.state.session.status(id) as Loose | undefined
        return status
          ? translate.event({ type: "session.status", properties: { sessionID: id, status } })
          : []
      },
      dispose: () => {
        for (const off of offs.splice(0)) off()
      },
    }
  }

  const v2 = api.v2 as unknown as Loose
  const translate = createV2Translator(unknown)
  const off = v2.data.listen((event: unknown) => guard("event", () => emit(translate.event(event))))
  if (typeof off === "function") offs.push(off)
  return {
    async load(root) {
      const sessions = (v2.data.session.list() ?? []) as Loose[]
      const byId = new Map(sessions.map((s) => [s.id as string, s]))
      const family = new Set<string>((v2.data.session.family(root) ?? []) as string[])
      for (const id of family) {
        const info = byId.get(id)
        if (!info?.parentID) continue
        let messages = (v2.data.session.message.list(id) ?? []) as unknown[]
        if (messages.length === 0) {
          await Promise.resolve(v2.data.session.message.sync(id)).catch((error: unknown) =>
            log.warn("history sync failed", { id, error }),
          )
          messages = (v2.data.session.message.list(id) ?? []) as unknown[]
        }
        const status = translate.status(id, v2.data.session.status(id))
        emit([
          ...translate.session(info),
          ...translate.history(id, messages),
          /** Not known to the host is not running: the same lesson as OpenCode 1's store. */
          ...(status.length > 0
            ? status
            : ([
                { type: "status", id, status: "idle", at: Number(info.time?.updated) || Date.now() },
              ] as Change[])),
        ])
      }
    },
    async send(id, text, busy) {
      await v2.client.session.prompt({ sessionID: id, text, ...(busy ? { delivery: "steer" } : {}) })
    },
    async stop(id) {
      await v2.client.session.interrupt({ sessionID: id })
    },
    async background(parentID) {
      await v2.client.session.background({ sessionID: parentID })
      return true
    },
    async note(sessionID, text, busy) {
      await v2.client.session.prompt({ sessionID, text, ...(busy ? { delivery: "steer" } : {}) })
    },
    check(id) {
      return translate.status(id, v2.data.session.status(id))
    },
    dispose: () => {
      for (const each of offs.splice(0)) each()
    },
  }
}
