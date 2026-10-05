/** How the session is going: work outstanding, work in progress, time spent. */

import { toneOf } from "@opencode-cockpit/client/design"
import type { SegmentConfig } from "../config/index.ts"
import { todoRemaining } from "../context.ts"
import { duration, preciseDuration } from "../format.ts"
import type { SegmentDef } from "../types.ts"
import { formatted } from "./settings.ts"

/** "3m42s" while you are watching it; "2h 5m" once the seconds stop mattering, or with `coarse`. */
const clock = (elapsed: number, config: SegmentConfig): string =>
  config.coarse === true ? duration(Math.max(0, elapsed)) : preciseDuration(Math.max(0, elapsed))

export const SEGMENTS: SegmentDef[] = [
  {
    name: "todo",
    icon: "▤",
    priority: 55,
    render(ctx, config: SegmentConfig) {
      const todo = ctx.session?.todo
      if (!todo || todo.total === 0) return undefined
      const left = todoRemaining(ctx.session)
      /**
       * A finished list has nothing left to act on, and todos live for the whole session -- so
       * "5/5 todo" would sit there for the rest of it, saying only that you already finished.
       * `showComplete` keeps it for anyone who wants the confirmation.
       */
      if (left === 0 && config.showComplete !== true) return undefined
      const shaped = formatted(config, { done: todo.completed, total: todo.total, left })
      if (shaped) return shaped
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
    render(ctx, config) {
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
      /** `"working": false` keeps the row for what is wrong (a retry) and drops the turn's clock. */
      if (session.status === "busy" && config.working !== false) {
        // From the prompt, not from the session's creation: a conversation reopened two days later
        // was `working 2d 15h` within a second of being asked something.
        const started = session.turn?.startedAt
        /** Running, in the tone every bay gives a thing in motion. */
        return {
          text: started ? `working ${preciseDuration(ctx.now - started)}` : "working",
          tone: toneOf("running"),
        }
      }
      return undefined // idle is the normal state; saying so every frame is noise
    },
  },
  {
    name: "session.time",
    icon: "◷",
    priority: 20,
    /**
     * Two clocks, chosen with `of`.
     *
     * `"session"`, the default, is how old the conversation is: from its creation, so one reopened
     * two days later reads `2d 15h`. It stays the default so a line someone wrote keeps saying what
     * it said.
     *
     * `"turn"` is how long the last answer took — `took 3m42s` — which is what "how long" means while
     * you are working. It is silent while a turn runs, because `session.status` is already counting
     * that one (`working 1m02s`, from the same prompt), and two clocks on one line is one too many.
     * The built-in lines use it.
     */
    render(ctx, config) {
      const session = ctx.session
      // `"turn"` is labelled because nothing else says which clock it is; the default line draws
      // no icons. `"session"` keeps its bare number, and its `◷`, for the lines already written.
      if (config.of === "turn") {
        const turn = session?.turn
        if (!turn || turn.endedAt === undefined || session?.status !== "idle") return undefined
        return { text: `took ${clock(turn.endedAt - turn.startedAt, config)}`, tone: "muted" }
      }
      const started = session?.startedAt
      // `=== undefined`, not falsy: a startedAt of 0 is a real instant, not a missing one.
      if (started === undefined) return undefined
      return { text: clock(ctx.now - started, config), tone: "muted" }
    },
  },
]
