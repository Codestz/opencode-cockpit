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
            emit([
              ...translate.session(child),
              ...translate.history(history),
              ...(status?.type === "busy"
                ? ([{ type: "status", id, status: "busy", at: Date.now() }] as Change[])
                : []),
              ...(status?.type === "idle" && history.length > 0
                ? ([
                    { type: "status", id, status: "idle", at: Number(child.time?.updated) || Date.now() },
                  ] as Change[])
                : []),
            ])
            await visit(id, depth + 1)
          }
        }
        await visit(root, 0)
      },
      async send(id, text, _busy, agent) {
        await v1.client.session.promptAsync({ sessionID: id, agent, parts: [{ type: "text", text }] })
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
        emit([
          ...translate.session(info),
          ...translate.history(id, messages),
          ...translate.status(id, v2.data.session.status(id)),
        ])
      }
    },
    async send(id, text, busy) {
      await v2.client.session.prompt({ sessionID: id, text, ...(busy ? { delivery: "steer" } : {}) })
    },
    dispose: () => {
      for (const each of offs.splice(0)) each()
    },
  }
}
