/**
 * OpenCode 2's events, as what Trust takes from them.
 *
 * `ctx.data.listen` hands over `{ name, details: { data } }`. Shapes measured on 2.0.18
 * (docs/opencode/permissions.md) and read from its own schema (`Permission.Request`):
 *
 *   permission.asked    { id, sessionID, action: "shell", resources, save, metadata, message,
 *                         source: { type: "tool", messageID, id } }
 *   permission.replied  { sessionID, requestID, reply }
 *   session.tool.called { sessionID, assistantMessageID, id, input }   — a shell call's `command`, `cwd`
 *   session.created     { sessionID, agent }
 *   session.agent.selected { sessionID, agent }
 *   config.updated      {}
 *
 * The request carries no agent (v2's schema has none), so it comes from the session's events.
 */

import { canonical } from "../rules.ts"
import { isReply, obj, type Seen, str, strings } from "./seen.ts"

export function fromV2Event(raw: unknown): Seen[] {
  const event = obj(raw)
  const name = str(event.name) ?? str(event.type)
  const details = obj(event.details)
  /** `details.data`, as measured; the bare payload too, for a request read from a list. */
  const data = obj(details.data ?? event.data ?? event.properties)
  switch (name) {
    case "permission.asked": {
      const id = str(data.id)
      const sessionID = str(data.sessionID)
      const action = str(data.action) ?? str(data.permission)
      if (!id || !sessionID || !action) return []
      const source = obj(data.source)
      const call = source.type === "tool" ? str(source.id) : undefined
      return [
        {
          type: "asked",
          request: {
            id,
            sessionID,
            permission: canonical(action),
            patterns: strings(data.resources ?? data.patterns),
            always: strings(data.save ?? data.always),
            ...(call ? { call } : {}),
            ...(str(source.messageID) ? { messageID: str(source.messageID) as string } : {}),
          },
        },
      ]
    }
    case "permission.replied": {
      const sessionID = str(data.sessionID)
      const requestID = str(data.requestID)
      const reply = data.reply ?? data.decision
      return sessionID && requestID && isReply(reply)
        ? [{ type: "replied", sessionID, requestID, reply }]
        : []
    }
    case "session.tool.called": {
      const sessionID = str(data.sessionID)
      const call = str(data.id)
      const input = obj(data.input)
      if (!sessionID || !call || Object.keys(input).length === 0) return []
      const messageID = str(data.assistantMessageID) ?? str(data.messageID)
      return [{ type: "call", sessionID, call, ...(messageID ? { messageID } : {}), input }]
    }
    case "session.created":
    case "session.agent.selected": {
      const sessionID = str(data.sessionID)
      const agent = str(data.agent)
      return sessionID && agent ? [{ type: "agent", sessionID, agent }] : []
    }
    case "config.updated":
      return [{ type: "config" }]
    default:
      return []
  }
}

/** A pending request from a list, in the same shape as the event's data. */
export function fromV2Pending(list: unknown): Seen[] {
  return (Array.isArray(list) ? list : []).flatMap((request) =>
    fromV2Event({ name: "permission.asked", details: { data: request } }),
  )
}
