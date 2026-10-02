/**
 * Sample worlds for the preview and the grid test: the states a design gets wrong
 * (docs/building/testing.md) — nothing at all, a first week, a busy project, a paused one, one
 * where something broke, and one grouped into families with one of them widened by hand.
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
    auto(line, times, permission = "bash", agent = "build") {
      for (let i = 0; i < times; i++) {
        const { id, judgement } = ask(line, permission, [line], agent)
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
    widen(family, agent, permission = "bash") {
      engine.load([{ v: 1, at: clock, type: "widened", permission, agent, family }])
      clock += 1_000
    },
  }
  script(steps)
  return engine
}

interface Steps {
  at: (ms: number) => void
  approve: (line: string, times: number, how?: "once" | "always", permission?: string, agent?: string) => void
  auto: (line: string, times: number, permission?: string, agent?: string) => void
  pending: (line: string) => void
  /** You pressed `w` on a family: the only way a `widened` event is ever made. */
  widen: (family: string, agent: string, permission?: string) => void
}

/** The `crowded` afternoon, as steps: the oldest first, so the newest are what the ledger leads with. */
function crowd(s: Steps): void {
  const general = (line: string, times: number, how: "once" | "always" = "once") =>
    s.approve(line, times, how, "bash", "general")
  /** An agent reading a project: each of these asked once, and never again. */
  for (let i = 1; i <= 101; i++)
    s.approve(i % 3 === 0 ? `wc -l src/part${i}.ts` : `sed -n ${i},${i + 40}p src/part${i}.ts`, 1)
  s.approve("git push origin feat/trust", 5)
  s.approve("rm -rf dist", 4)
  s.approve("docker compose -p prod down -v", 2)
  for (const line of ["uniq -c", "wc -l", 'sed "s|^\\./||"', "sort", "sort -rn"]) general(line, 3)
  general('find packages -type f -not -path "*/dist/*"', 3)
  general('find site -type f -not -path "site/node_modules/*" -not -path "site/dist/*"', 2)
  general("find . -path ./.git -prune -o -type f -print", 2)
  general("head -30", 3)
  for (const line of ["head -40", "head -80", "head -50", "head -20"]) general(line, 2)
  general("find . -name '*.md'", 1, "always")
  general("ls src", 1, "always")
  s.at(SAMPLE_NOW - 3_600_000)
  general("cat package.json", 2)
  s.widen("cat", "general")
  s.auto("cat package.json", 2, "bash", "general")
  s.auto("cat src/app.ts", 1, "bash", "general")
  s.approve("bun --version", 2)
  s.approve("exit 0", 2)
  general("exit 1", 2)
  general("sleep 5", 2)
  general("echo ---", 3)
  general("echo boom", 2)
  s.approve("echo trust-test", 3)
  s.approve("git status --short", 3)
  general("git status --short", 2)
  s.approve("ls -la", 3)
  general("ls -la", 3)
  s.at(SAMPLE_NOW - 120_000)
  s.auto("git status --short", 3)
  s.auto("echo trust-test", 1)
  s.auto("ls -la", 1)
  s.at(SAMPLE_NOW - 2_000)
  s.pending("git push origin feat/trust")
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

  /**
   * Families: three `ls` rules and one answered only because you widened `ls` for general; `echo ---`
   * (the line a font drew as `echo ──`); one `git status --short` earned by two agents; a dangerous
   * family that can never be widened; and a tail of commands approved once, folded.
   */
  families: () => ({
    engine: build((s) => {
      s.approve("ls -la", 3, "once", "bash", "general")
      s.approve("ls -la src", 3, "once", "bash", "general")
      s.approve("ls -R docs", 2, "once", "bash", "general")
      s.approve("echo ---", 3, "once", "bash", "general")
      s.approve("git status --short", 3)
      s.approve("git status --short", 2, "once", "bash", "general")
      s.approve("git -C packages/web status", 3)
      s.approve("git push origin feat/trust", 5)
      s.approve("docker compose -p cockpit up -d", 3)
      s.approve("docker compose -p prod down -v", 2)
      s.approve("src/app.ts", 3, "once", "edit")
      s.approve("src/view.ts", 2, "once", "edit")
      for (const once of ["head -60 README.md", "wc -l src/app.ts", "cat package.json", "pwd"])
        s.approve(once, 1)
      s.at(SAMPLE_NOW - 900_000)
      s.widen("ls", "general")
      s.at(SAMPLE_NOW - 600_000)
      s.auto("ls -la", 3, "bash", "general")
      s.auto("echo ---", 1, "bash", "general")
      s.auto("git status --short", 2)
      s.auto("ls -x", 1, "bash", "general")
    }),
  }),

  /**
   * A real afternoon, as a user's screenshots of the ledger showed it: two agents, a hundred commands
   * approved once, families half trusted and half counting, a family widened by hand, dangerous rules
   * on their way, a long `find`, the `---` a font merges, and OpenCode's own "always" twice.
   */
  crowded: () => ({ engine: build(crowd) }),

  /** The same afternoon, paused: the dialog has to say it before anything else. */
  "crowded-paused": () => {
    const engine = build(crowd)
    engine.load([{ v: 1, at: SAMPLE_NOW - 60_000, type: "paused" }])
    return { engine }
  },

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
