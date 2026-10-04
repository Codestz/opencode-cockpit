/**
 * What the interface asks OpenCode about conversations, on either version: a session's parent and
 * title, the project's sessions, and the jump to one. The client host has none of these, so they are
 * reached through the version's own API (`api.v1`, `api.v2`) — the calls docs/opencode/trail-interface.md measured.
 *
 * - **Lists are the project's**: v1 `list({ scope: "project" })`; v2 `list({ project })` always —
 *   v2's bare `list({})` is every session on the machine.
 * - **Don't use the interface's caches as a list**: both versions' synced state holds only what this
 *   interface happened to load. Everything here goes through the client.
 * - The v1 client answers `{ data, error }`; the v2 client answers the data and throws.
 */

import type { Host } from "@opencode-cockpit/client/host"
import type { Log } from "@opencode-cockpit/client/log"

export interface SessionInfo {
  id: string
  parentID?: string
  title?: string
}

export interface Sessions {
  get(id: string): Promise<SessionInfo | undefined>
  /** The project's conversations, children included; empty when the host would not say. */
  list(): Promise<SessionInfo[]>
  /** Switch the interface to a conversation. */
  navigate(id: string): void
}

type Call = (input: Record<string, unknown>) => Promise<unknown>

interface V1Client {
  session: { get: Call; list: Call }
}
interface V2Client {
  session: { get: Call; list: Call }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

function infoOf(value: unknown): SessionInfo | undefined {
  if (!isObject(value) || typeof value.id !== "string") return undefined
  return {
    id: value.id,
    ...(typeof value.parentID === "string" ? { parentID: value.parentID } : {}),
    ...(typeof value.title === "string" ? { title: value.title } : {}),
  }
}

const listOf = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : isObject(value) && Array.isArray(value.data) ? value.data : []

export function createSessions(api: Host, log: Log): Sessions {
  if (api.v1) {
    const v1 = api.v1
    const client = v1.client as unknown as V1Client
    /** v1 answers `{ data, error }` and does not throw. */
    const data = async (call: Promise<unknown>) => {
      const answer = await call
      return isObject(answer) && "data" in answer ? answer.data : undefined
    }
    return {
      get: async (id) => infoOf(await data(client.session.get({ sessionID: id })).catch(() => undefined)),
      list: async () =>
        listOf(await data(client.session.list({ scope: "project" })).catch(() => [])).flatMap(
          (s) => infoOf(s) ?? [],
        ),
      navigate: (id) => v1.route.navigate("session", { sessionID: id }),
    }
  }

  const ctx = api.v2
  if (!ctx) throw new Error("trail: neither OpenCode 1 nor 2")
  const client = ctx.client as V2Client
  const project = (ctx.location as { project?: { id?: string } } | undefined)?.project?.id
  return {
    get: async (id) => infoOf(await client.session.get({ sessionID: id }).catch(() => undefined)),
    list: async () => {
      if (!project) {
        log.debug("no project id; not listing sessions")
        return []
      }
      return listOf(await client.session.list({ project, limit: 500 }).catch(() => [])).flatMap(
        (s) => infoOf(s) ?? [],
      )
    },
    navigate: (id) =>
      (ctx.ui.router as unknown as { navigate(to: { type: string; sessionID: string }): void }).navigate({
        type: "session",
        sessionID: id,
      }),
  }
}
