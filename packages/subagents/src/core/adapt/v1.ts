/**
 * OpenCode 1's events and state, as changes.
 *
 * OpenCode 1 describes a run as parts of messages: a part is created (`message.part.updated`), may
 * stream (`message.part.delta`, which names the part but not its kind — so kinds are remembered), and
 * is updated as it completes. A user message's text is what the session was told; an assistant's
 * `reasoning` and `text` are its thinking and its answer; a `tool` part is a call. Shapes measured on
 * 1.18.32 (test/fixtures/v1.jsonl).
 *
 * Anything it does not recognise it returns nothing for, and says so through `unknown` — a new event
 * shape is logged, never guessed at.
 */

import type { Change, ToolState } from "../model/changes.ts"

type Json = Record<string, unknown>
const obj = (value: unknown): Json => (value && typeof value === "object" ? (value as Json) : {})
const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined)

const TOOL_STATES = new Set<ToolState>(["pending", "running", "completed", "failed"])
const toolState = (status: unknown): ToolState | undefined => {
  if (status === "error") return "failed"
  return TOOL_STATES.has(status as ToolState) ? (status as ToolState) : undefined
}

export interface V1Translator {
  /** One host event as changes. */
  event(event: unknown, at?: number): Change[]
  /** A session's stored messages (each `{ info, parts }`), for one that existed before we did. */
  history(messages: readonly { info: unknown; parts: readonly unknown[] }[], at?: number): Change[]
  /** A session as `session.children` or `state.session.get` returns it. */
  session(info: unknown, at?: number): Change[]
}

export function createV1Translator(unknown: (what: string, detail?: Json) => void = () => {}): V1Translator {
  /** Parts stream by id alone; what kind of part an id is, and whose. */
  const parts = new Map<string, { kind: "thinking" | "reply" | "prompt"; session: string }>()
  /** Message roles, since a part does not carry its message's. */
  const roles = new Map<string, string>()

  const sessionInfo = (info: Json, at: number): Change[] => {
    const id = str(info.id)
    if (!id) return []
    const out: Change[] = [
      {
        type: "session",
        id,
        ...(str(info.parentID) ? { parentID: str(info.parentID) as string } : {}),
        ...(str(info.agent) ? { agent: str(info.agent) as string } : {}),
        ...(str(info.title) ? { title: stripAgentSuffix(str(info.title) as string) } : {}),
        at: Number(obj(info.time).created) || at,
      },
    ]
    const tokens = obj(info.tokens)
    if (typeof info.cost === "number" || Object.keys(tokens).length > 0) {
      out.push({ type: "usage", id, tokens: tokenTotal(tokens), cost: Number(info.cost) || 0, at })
    }
    return out
  }

  const part = (p: Json, at: number): Change[] => {
    const id = str(p.sessionID)
    const partID = str(p.id)
    if (!id || !partID) return []
    const role = roles.get(str(p.messageID) ?? "")
    switch (p.type) {
      case "text":
        if (role === "user") {
          parts.set(partID, { kind: "prompt", session: id })
          return str(p.text) && !p.synthetic
            ? [{ type: "prompt", id, key: partID, text: str(p.text) as string, at }]
            : []
        }
        parts.set(partID, { kind: "reply", session: id })
        return [
          { type: "reply", id, key: partID, text: str(p.text) ?? "", done: Boolean(obj(p.time).end), at },
        ]
      case "reasoning":
        parts.set(partID, { kind: "thinking", session: id })
        return [
          { type: "thinking", id, key: partID, text: str(p.text) ?? "", done: Boolean(obj(p.time).end), at },
        ]
      case "tool": {
        const state = obj(p.state)
        const metadata = obj(state.metadata)
        const status = toolState(state.status)
        const output = str(state.output) ?? (status === "running" ? str(metadata.output) : undefined)
        return [
          {
            type: "tool",
            id,
            call: str(p.callID) ?? partID,
            ...(str(p.tool) ? { name: str(p.tool) as string } : {}),
            ...(status ? { state: status } : {}),
            ...(Object.keys(obj(state.input)).length > 0 ? { input: obj(state.input) } : {}),
            ...(output !== undefined ? { output } : {}),
            ...(str(state.error) ? { error: str(state.error) as string } : {}),
            at,
          },
        ]
      }
      case "step-start":
      case "step-finish":
      case "patch":
      case "snapshot":
      case "file":
      case "agent":
      case "compaction":
      case "subtask":
      case "retry":
        return []
      default:
        unknown("part", { type: p.type })
        return []
    }
  }

  return {
    event(raw, at = Date.now()) {
      const event = obj(raw)
      const props = obj(event.properties)
      const sessionID = str(props.sessionID)
      switch (event.type) {
        case "session.created":
        case "session.updated":
          return sessionInfo(obj(props.info), at)
        case "session.status": {
          const status = obj(props.status).type
          if (!sessionID) return []
          if (status === "busy" || status === "retry")
            return [{ type: "status", id: sessionID, status: "busy", at }]
          if (status === "idle") return [{ type: "status", id: sessionID, status: "idle", at }]
          return []
        }
        case "session.idle":
          return sessionID ? [{ type: "status", id: sessionID, status: "idle", at }] : []
        case "session.error": {
          if (!sessionID) return []
          const error = obj(props.error)
          const message = str(obj(error.data).message) ?? str(error.name) ?? "failed"
          return [{ type: "status", id: sessionID, status: "failed", error: message, at }]
        }
        case "permission.asked":
        case "question.asked":
          return sessionID ? [{ type: "status", id: sessionID, status: "waiting", at }] : []
        case "permission.replied":
        case "question.replied":
        case "question.rejected":
          return sessionID ? [{ type: "status", id: sessionID, status: "busy", at }] : []
        case "message.updated": {
          const info = obj(props.info)
          if (str(info.id) && str(info.role)) roles.set(str(info.id) as string, str(info.role) as string)
          return []
        }
        case "message.part.updated":
          return part(obj(props.part), at)
        case "message.part.delta": {
          const known = parts.get(str(props.partID) ?? "")
          const delta = str(props.delta)
          if (!known || !delta || props.field !== "text" || known.kind === "prompt") return []
          return [{ type: known.kind, id: known.session, key: str(props.partID) as string, delta, at }]
        }
        case "session.deleted":
        case "session.diff":
        case "message.removed":
        case "message.part.removed":
        case "todo.updated":
          return []
        default:
          unknown("event", { type: event.type })
          return []
      }
    },
    history(messages, at = Date.now()) {
      const out: Change[] = []
      for (const message of messages) {
        const info = obj(message.info)
        if (str(info.id) && str(info.role)) roles.set(str(info.id) as string, str(info.role) as string)
        const when = Number(obj(info.time).created) || at
        for (const p of message.parts) out.push(...part(obj(p), when))
      }
      return out
    },
    session(info, at = Date.now()) {
      return sessionInfo(obj(info), at)
    },
  }
}

/** `input + output + reasoning + cache`, the host's own total. */
export function tokenTotal(tokens: Json): number {
  const cache = obj(tokens.cache)
  const n = (value: unknown) => (typeof value === "number" ? value : 0)
  return n(tokens.input) + n(tokens.output) + n(tokens.reasoning) + n(cache.read) + n(cache.write)
}

/** OpenCode 1 titles a subagent session "Task title (@explore subagent)"; the agent is shown apart. */
export function stripAgentSuffix(title: string): string {
  return title.replace(/\s*\(@[\w-]+ subagent\)\s*$/, "")
}
