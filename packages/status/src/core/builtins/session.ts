/** How the session is going: work outstanding, work in progress, time spent. */

import { todoRemaining } from "../context.ts"
import { duration, preciseDuration } from "../format.ts"
import type { SegmentDef } from "../types.ts"

export const SEGMENTS: SegmentDef[] = [
  {
    name: "todo",
    icon: "▤",
    priority: 55,
    render(ctx) {
      const todo = ctx.session?.todo
      if (!todo || todo.total === 0) return undefined
      const left = todoRemaining(ctx.session)
      return {
        text: `${todo.completed}/${todo.total} todo`,
        tone: left === 0 ? "success" : "muted",
      }
    },
  },
  {
    name: "session.status",
    icon: "●",
    priority: 95,
    render(ctx) {
      const session = ctx.session
      if (!session) return undefined
      if (session.status === "retry") {
        // Retries are invisible in OpenCode today; a stuck session looks identical to a slow one.
        const retry = session.retry
        const wait = retry ? duration(Math.max(0, retry.next - ctx.now)) : ""
        return {
          text: `retry ${retry?.attempt ?? 1}${wait ? ` in ${wait}` : ""}`,
          tone: "warning",
        }
      }
      if (session.status === "busy") {
        const started = session.startedAt
        return {
          text: started ? `working ${preciseDuration(ctx.now - started)}` : "working",
          tone: "info",
        }
      }
      return undefined // idle is the normal state; saying so every frame is noise
    },
  },
  {
    name: "session.time",
    icon: "◷",
    priority: 20,
    render(ctx, config) {
      const started = ctx.session?.startedAt
      if (!started) return undefined
      const elapsed = ctx.now - started
      // "3m42s" while you are watching it; "2h 5m" once the seconds stop mattering.
      const text = config.coarse === true ? duration(elapsed) : preciseDuration(elapsed)
      return { text, tone: "muted" }
    },
  },
]
