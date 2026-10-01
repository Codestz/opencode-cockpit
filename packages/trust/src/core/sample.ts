/**
 * Sample worlds for the preview and the grid test: the states a design gets wrong
 * (docs/building/testing.md) — nothing at all, a first week, a busy project, a paused one, and one
 * where something broke.
 *
 * Each is built by running the real engine over real requests, so the preview shows what the
 * engine actually produces rather than what a hand-written state hoped it would.
 */

import { createEngine, type Engine } from "./engine.ts"
import type { Request } from "./keys.ts"
import { DAY } from "./ledger.ts"
import { rulesFrom } from "./rules.ts"

export const SAMPLE_ROOT = "/work/app"
export const SAMPLE_NOW = 1_790_300_000_000
export const SAMPLE_SETTINGS = { threshold: 3, dangerExtra: 5, expireDays: 30, keep: 20 }

export interface Sample {
  engine: Engine
  trouble?: string
}

const RULES = rulesFrom({
  permission: { bash: { "*": "ask", "npm publish *": "ask" }, edit: "ask", webfetch: "ask" },
})

function build(script: (step: Steps) => void): Engine {
  const engine = createEngine(SAMPLE_SETTINGS)
  let n = 0
  let clock = SAMPLE_NOW - 3 * DAY
  const ask = (line: string, permission = "bash", patterns = [line], agent = "build") => {
    n++
    const request: Request = {
      id: `per_${n}`,
      sessionID: "ses_sample",
      permission,
      patterns,
      always: permission === "bash" ? [`${line.split(" ").slice(0, 2).join(" ")} *`] : ["*"],
      call: `call_${n}`,
    }
    const { judgement, event } = engine.ask({
      request,
      context: { line, root: SAMPLE_ROOT },
      agent,
      rules: RULES,
      at: clock,
    })
    engine.load([event])
    return { id: request.id, judgement }
  }
  const steps: Steps = {
    at: (ms) => {
      clock = ms
    },
    approve(line, times, how = "once", permission = "bash", agent = "build") {
      for (let i = 0; i < times; i++) {
        const { id } = ask(line, permission, [line], agent)
        clock += 2_000
        engine.load(engine.replied({ requestID: id, reply: how, at: clock }).events)
        clock += 60_000
      }
    },
    auto(line, times, permission = "bash") {
      for (let i = 0; i < times; i++) {
        const { id, judgement } = ask(line, permission, [line])
        if (!judgement.answer) throw new Error(`sample: ${line} is not trusted (${judgement.why})`)
        clock += 25
        const event = engine.answered(id, clock)
        if (event) engine.load([event])
        engine.replied({ requestID: id, reply: "once", at: clock + 5 })
        clock += 90_000
      }
    },
    pending(line) {
      ask(line)
    },
  }
  script(steps)
  return engine
}

interface Steps {
  at: (ms: number) => void
  approve: (line: string, times: number, how?: "once" | "always", permission?: string, agent?: string) => void
  auto: (line: string, times: number, permission?: string) => void
  pending: (line: string) => void
}

export const SAMPLES: Record<string, () => Sample> = {
  /** A new install: nothing approved, nothing to say. */
  empty: () => ({ engine: build(() => {}) }),

  /** A first session: one command trusted and answered, one being counted, on screen now. */
  first: () => ({
    engine: build((s) => {
      s.approve("git status", 3)
      s.at(SAMPLE_NOW - 600_000)
      s.auto("git status", 1)
      s.approve("docker compose -p cockpit up -d", 2)
      s.at(SAMPLE_NOW - 1_000)
      s.pending("docker compose -p cockpit up -d")
    }),
  }),

  /** A busy project: several trusted, a dangerous one half way, an "always" given to OpenCode. */
  busy: () => ({
    engine: build((s) => {
      s.approve("git status", 3)
      s.approve("bun test", 3)
      s.approve("src/app.ts", 3, "once", "edit")
      s.approve("https://docs.example.com/guide", 3, "once", "webfetch")
      s.approve("cd packages/web && bun run build", 4)
      s.approve("git push origin feat/trust", 5)
      s.approve("docker compose -p cockpit logs -f api", 1, "always")
      s.approve("ls -la", 3, "once", "bash", "general")
      s.at(SAMPLE_NOW - 3_600_000)
      s.auto("git status", 6)
      s.auto("bun test", 4)
      s.auto("src/app.ts", 2, "edit")
      s.auto("cd packages/web && bun run build", 1)
      s.at(SAMPLE_NOW - 2_000)
      s.pending("git push origin feat/trust")
    }),
  }),

  /** Paused: still learning, answering nothing — and the block says so. */
  paused: () => {
    const engine = build((s) => {
      s.approve("git status", 3)
    })
    engine.load([{ v: 1, at: SAMPLE_NOW - 60_000, type: "paused" }])
    return { engine }
  },

  /** The ledger could not be written: the block speaks even with nothing else to say. */
  trouble: () => ({
    engine: build(() => {}),
    trouble: "ledger not saved: EACCES",
  }),
}
