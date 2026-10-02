/**
 * OpenCode 1's events, as what Trust takes from them.
 *
 * `api.event.on(type)` hands over `{ type, properties }`. Shapes measured on 1.18.32
 * (docs/opencode/permissions.md, and Subagents' recorded run for the message events):
 *
 *   permission.asked    { id, sessionID, permission: "bash", patterns, always, metadata,
 *                         tool: { messageID, callID } }
 *   permission.replied  { sessionID, requestID, reply: "once" | "always" | "reject" }
 *   message.part.updated  { part: { type: "tool", callID, sessionID, messageID, state: { input } } }
 *   message.updated     { info: { sessionID, agent } }
 *   session.created/updated { info: { id, agent } }   — a subagent's session names its agent
 */

import { canonical } from "../rules.ts"
import { isReply, obj, type Seen, str, strings } from "./seen.ts"

export const V1_EVENTS = [
  "permission.asked",
  "permission.replied",
  "message.part.updated",
  "message.updated",
  "session.created",
  "session.updated",
] as const

export function fromV1Event(raw: unknown): Seen[] {
  const event = obj(raw)
  const props = obj(event.properties)
  switch (event.type) {
    case "permission.asked": {
      const id = str(props.id)
      const sessionID = str(props.sessionID)
      const permission = str(props.permission)
      if (!id || !sessionID || !permission) return []
      const tool = obj(props.tool)
      return [
        {
          type: "asked",
          request: {
            id,
            sessionID,
            permission: canonical(permission),
            patterns: strings(props.patterns),
            always: strings(props.always),
            ...(str(tool.callID) ? { call: str(tool.callID) as string } : {}),
            ...(str(tool.messageID) ? { messageID: str(tool.messageID) as string } : {}),
          },
        },
      ]
    }
    case "permission.replied": {
      const sessionID = str(props.sessionID)
      const requestID = str(props.requestID) ?? str(props.permissionID)
      const reply = props.reply ?? props.response
      return sessionID && requestID && isReply(reply)
        ? [{ type: "replied", sessionID, requestID, reply }]
        : []
    }
    case "message.part.updated": {
      const part = obj(props.part)
      const call = str(part.callID)
      const sessionID = str(part.sessionID)
      const input = obj(obj(part.state).input)
      if (part.type !== "tool" || !call || !sessionID || Object.keys(input).length === 0) return []
      return [
        {
          type: "call",
          sessionID,
          call,
          ...(str(part.messageID) ? { messageID: str(part.messageID) as string } : {}),
          input,
        },
      ]
    }
    case "message.updated": {
      const info = obj(props.info)
      const sessionID = str(info.sessionID)
      const agent = str(info.agent) ?? str(info.mode)
      return sessionID && agent ? [{ type: "agent", sessionID, agent }] : []
    }
    case "session.created":
    case "session.updated": {
      const info = obj(props.info)
      const sessionID = str(info.id)
      const agent = str(info.agent)
      return sessionID && agent ? [{ type: "agent", sessionID, agent }] : []
    }
    default:
      return []
  }
}

/** A pending request as `client.permission.list()` returns it: the same shape as the event. */
export function fromV1Pending(list: unknown): Seen[] {
  return (Array.isArray(list) ? list : []).flatMap((request) =>
    fromV1Event({ type: "permission.asked", properties: request }),
  )
}
