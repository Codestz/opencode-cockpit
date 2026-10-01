/**
 * Trust's reach into a specific OpenCode: its events, its reply, its config and its pending list.
 * The only file past `Host` — through `api.v1` / `api.v2`, as Subagents' source does — and every call
 * was measured or read from the version's own client (docs/opencode/permissions.md):
 *
 * | | OpenCode 1 | OpenCode 2 |
 * | --- | --- | --- |
 * | events | `api.event.on(type)` | `ctx.data.listen` |
 * | answer | `client.permission.reply({ requestID, reply })` | `client.permission.reply({ sessionID, requestID, decision })` |
 * | config | `client.config.get()` — merged | `client.config.get({ location })` — documents, lowest first |
 * | pending | `client.permission.list()` | `client.permission.request.list({ location })` |
 *
 * What it hears becomes `Seen` through the pure adapters in `core/adapt/`.
 */

import type { Host } from "@opencode-cockpit/client/host"
import type { Log } from "@opencode-cockpit/client/log"
import { commandOf, obj, type Seen, str } from "../core/adapt/seen.ts"
import { fromV1Event, fromV1Pending, V1_EVENTS } from "../core/adapt/v1.ts"
import { fromV2Event, fromV2Pending } from "../core/adapt/v2.ts"
import type { Request } from "../core/keys.ts"

export interface Source {
  /** Says "once" to a request: the only answer Trust ever gives. */
  approve: (request: Request) => Promise<void>
  /** OpenCode's config, as its `config.get` returns it, for `rulesFrom`. */
  config: () => Promise<unknown>
  /** Requests pending now, by the host's own account; undefined when it cannot say. */
  pending: () => Promise<Seen[] | undefined>
  /** The call's command line from the host's own store, when its events have not said it yet. */
  call: (request: Request) => { line?: string; workdir?: string } | undefined
  /** The agent a session runs as, from the host's own store. */
  agent: (sessionID: string, messageID?: string) => string | undefined
  dispose: () => void
}

// biome-ignore lint/suspicious/noExplicitAny: the host's objects, reached by measured shapes only
type Loose = Record<string, any>

/** A client result: the plugin's client hands back `{ data }`, some calls the data itself. */
const unwrap = (result: unknown): unknown => {
  const value = obj(result)
  if (value.error) throw new Error(str(obj(value.error).message) ?? JSON.stringify(value.error))
  return "data" in value ? value.data : result
}

export function createSource(api: Host, log: Log, emit: (seen: Seen[]) => void): Source {
  const offs: (() => void)[] = []
  const guard = (fn: () => void) => {
    try {
      fn()
    } catch (error) {
      log.error("event failed", { error })
    }
  }

  if (api.v1) {
    const v1 = api.v1 as unknown as Loose
    for (const type of V1_EVENTS) {
      const off = v1.event.on(type, (event: unknown) => guard(() => emit(fromV1Event(event))))
      if (typeof off === "function") offs.push(off)
    }
    return {
      async approve(request) {
        unwrap(await v1.client.permission.reply({ requestID: request.id, reply: "once" }))
      },
      async config() {
        return unwrap(await v1.client.config.get())
      },
      async pending() {
        return fromV1Pending(unwrap(await v1.client.permission.list()))
      },
      call(request) {
        if (!request.messageID || !request.call) return undefined
        const parts = (v1.state.part?.(request.messageID) ?? []) as Loose[]
        const part = parts.find((each) => each?.callID === request.call)
        return part ? commandOf(obj(obj(part.state).input)) : undefined
      },
      agent(sessionID, messageID) {
        const messages = (v1.state.session?.messages?.(sessionID) ?? []) as Loose[]
        const info = (message: Loose) => obj(message?.info ?? message)
        const own = messageID ? messages.find((message) => info(message).id === messageID) : undefined
        const found = [own, ...[...messages].reverse()].find((message) => message && str(info(message).agent))
        return found ? str(info(found).agent) : undefined
      },
      dispose: () => {
        for (const off of offs.splice(0)) off()
      },
    }
  }

  const v2 = api.v2 as unknown as Loose
  const location = () => ({ directory: api.state.path.directory })
  const off = v2.data.listen((event: unknown) => guard(() => emit(fromV2Event(event))))
  if (typeof off === "function") offs.push(off)
  return {
    async approve(request) {
      unwrap(
        await v2.client.permission.reply({
          sessionID: request.sessionID,
          requestID: request.id,
          decision: "once",
        }),
      )
    },
    async config() {
      return unwrap(await v2.client.config.get({ location: location() }))
    },
    async pending() {
      const list = v2.client.permission?.request?.list
      if (typeof list !== "function") return undefined
      return fromV2Pending(unwrap(await list({ location: location() })))
    },
    call: () => undefined,
    agent(sessionID) {
      return str(obj(v2.data.session?.get?.(sessionID)).agent)
    },
    dispose: () => {
      for (const each of offs.splice(0)) each()
    },
  }
}
