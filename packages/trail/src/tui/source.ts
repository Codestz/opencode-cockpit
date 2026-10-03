/**
 * What the interface asks OpenCode about conversations, on either version: a session's parent and
 * title, the project's sessions, a session's children, its stored history (for the safety net's
 * finds), and the jump to one. The client host has none of these, so they are reached through the
 * version's own API (`api.v1`, `api.v2`) — the calls docs/opencode/trail-interface.md measured.
 *
 * - **Lists are the project's**: v1 `list({ scope: "project" })`; v2 `list({ project })` always —
 *   v2's bare `list({})` is every session on the machine.
 * - **Don't use the interface's caches as a list**: both versions' synced state holds only what this
 *   interface happened to load. Everything here goes through the client.
 * - The v1 client answers `{ data, error }`; the v2 client answers the data and throws.
 */

import type { Host } from "@opencode-cockpit/client/host"
import type { Log } from "@opencode-cockpit/client/log"
import type { Found } from "../core/model.ts"
import { addFinds, findsInV1, findsInV2 } from "../core/scan.ts"

export interface SessionInfo {
  id: string
  parentID?: string
  title?: string
}

export interface Sessions {
  get(id: string): Promise<SessionInfo | undefined>
  /** The project's conversations, children included; empty when the host would not say. */
  list(): Promise<SessionInfo[]>
  /** PR and issue links in what a conversation ran: its own calls and its subagents', from storage. */
  finds(root: string): Promise<Found[]>
  /** Switch the interface to a conversation. */
  navigate(id: string): void
}

type Call = (input: Record<string, unknown>) => Promise<unknown>

interface V1Client {
  session: { get: Call; list: Call; children: Call; messages: Call }
}
interface V2Client {
  session: { get: Call; list: Call; message?: { list: Call } }
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

/** How many of a conversation's subagents (and theirs) are read for finds. */
const CHILDREN_MAX = 40
/** Pages of a v2 conversation's history read, newest first. */
const PAGES_MAX = 8
const PAGE = 200

export function createSessions(api: Host, log: Log): Sessions {
  /** The conversation and its subagents, theirs included, breadth first, as each version lists them. */
  const family = async (root: string, children: (id: string) => Promise<SessionInfo[]>) => {
    const out: string[] = [root]
    for (let at = 0; at < out.length && out.length < CHILDREN_MAX; at++)
      for (const child of await children(out[at] as string).catch(() => []))
        if (!out.includes(child.id)) out.push(child.id)
    return out.slice(0, CHILDREN_MAX)
  }

  if (api.v1) {
    const v1 = api.v1
    const client = v1.client as unknown as V1Client
    /** v1 answers `{ data, error }` and does not throw. */
    const data = async (call: Promise<unknown>) => {
      const answer = await call
      return isObject(answer) && "data" in answer ? answer.data : undefined
    }
    const children = async (id: string) =>
      listOf(await data(client.session.children({ sessionID: id }))).flatMap((s) => infoOf(s) ?? [])
    return {
      get: async (id) => infoOf(await data(client.session.get({ sessionID: id })).catch(() => undefined)),
      list: async () =>
        listOf(await data(client.session.list({ scope: "project" })).catch(() => [])).flatMap(
          (s) => infoOf(s) ?? [],
        ),
      finds: async (root) => {
        const out: Found[] = []
        for (const id of await family(root, children)) {
          const messages = listOf(await data(client.session.messages({ sessionID: id })).catch(() => []))
          addFinds(out, findsInV1(messages))
        }
        return out
      },
      navigate: (id) => v1.route.navigate("session", { sessionID: id }),
    }
  }

  const ctx = api.v2
  if (!ctx) throw new Error("trail: neither OpenCode 1 nor 2")
  const client = ctx.client as V2Client
  const project = (ctx.location as { project?: { id?: string } } | undefined)?.project?.id
  const children = async (id: string) =>
    listOf(await client.session.list({ parentID: id })).flatMap((s) => infoOf(s) ?? [])
  /** Newest first, page by page, until the history runs out or the pages do. */
  const history = async (id: string): Promise<unknown[]> => {
    const list = client.session.message?.list
    if (!list) return []
    const out: unknown[] = []
    let cursor: unknown
    for (let page = 0; page < PAGES_MAX; page++) {
      const answer = await list({ sessionID: id, limit: PAGE, ...(cursor ? { cursor } : {}) })
      const items = listOf(answer)
      out.push(...items)
      const next = isObject(answer) && isObject(answer.cursor) ? answer.cursor.next : undefined
      if (!next || items.length < PAGE) break
      cursor = next
    }
    return out
  }
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
    finds: async (root) => {
      const out: Found[] = []
      for (const id of await family(root, children))
        addFinds(out, findsInV2(await history(id).catch(() => [])))
      return out
    },
    navigate: (id) =>
      (ctx.ui.router as unknown as { navigate(to: { type: string; sessionID: string }): void }).navigate({
        type: "session",
        sessionID: id,
      }),
  }
}
