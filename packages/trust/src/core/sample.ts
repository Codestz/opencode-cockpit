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
import { DAY, type Event } from "./ledger.ts"
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

/** Runs `script` on a fresh engine; `record` gets every event it loads, in order — a ledger file's lines. */
function build(script: (step: Steps) => void, record?: Event[]): Engine {
  const real = createEngine(SAMPLE_SETTINGS)
  const engine: Engine = Object.create(real)
  engine.load = (events, options) => {
    record?.push(...events)
    real.load(events, options)
  }
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

/**
 * A crowded storefront project (`acme-store`), as a user's ledger looked: one agent, `orchestrator`; a
 * `tail` family on one long ledger path, widened by hand; `ls` widened too; edits in five folders,
 * one of them outside the project; MCP calls through `mcpx`, `gh` and `jq`; a fetch and a subagent
 * type; a long tail of commands seen once; and OpenCode's own "always" given twice.
 */
function storefront(s: Steps): void {
  const agent = "orchestrator"
  const run = (line: string, times: number, how: "once" | "always" = "once") =>
    s.approve(line, times, how, "bash", agent)
  const edit = (path: string, times: number) => s.approve(path, times, "once", "edit", agent)
  const hour = 3_600_000
  const ledger = "~/.local/share/opencode-cockpit/trust/Projects-acme-store/events.ndjson"
  const review = "/var/folders/ab/x7k2q9/T/opencode-review"
  s.at(SAMPLE_NOW - 2 * DAY)
  run(`tail -4 ${ledger}`, 3)
  run(`tail -10 ${ledger}`, 2)
  for (const n of [3, 9, 8]) run(`tail -${n} ${ledger}`, 1)
  run(`ls -la ${review}`, 3)
  run(`ls -l ${review}/screens`, 2)
  run("git status --short", 2)
  for (const line of ["git log --oneline -20", "git log -1 --format=%H", "git log --stat -3"]) run(line, 1)
  run("git merge-base HEAD origin/main", 1)
  run("git merge-base --is-ancestor HEAD main", 1)
  run("gh pr view 482 --json url,title,state", 2)
  run("gh pr list --search SHOP-21 --state all", 2)
  run("gh api --method PATCH /repos/acme/store/pulls/482 -f body=@body.md", 2)
  run("sed -n 1p .env.example", 2)
  for (const line of [
    "jq '.items | length' report.json",
    "jq -r '.name' package.json",
    "jq '.scripts' package.json",
    "jq -c '.[]' out.json",
  ])
    run(line, 1)
  for (const line of ["head -40 README.md", "head -5 CHANGELOG.md", "echo $STORE_URL", "echo done"])
    run(line, 1)
  for (const line of ["grep -rn TODO src", "grep -c error build.log", "git branch -a"]) run(line, 1)
  run('mcpx db-local execute_sql --sql "select * from orders limit 5"', 3)
  run('mcpx db-local execute_sql --sql "select count(*) from customers"', 2)
  run('mcpx db-local execute_sql --sql "update orders set paid = true where id = 4"', 2)
  run("mcpx db-local list_tables", 3)
  run('mcpx db-prod execute_sql --sql "select * from orders limit 5"', 2)
  run("mcpx db-prod list_tables", 1)
  run("docker compose -p dev up -d", 3)
  run("docker compose -p dev logs web", 2)
  run("docker compose -p dev down", 1)
  run("docker compose -p prod up -d", 1)
  run("kubectl --context cluster-a get pods", 3)
  run("kubectl --context cluster-a get pods -o wide", 1)
  run("kubectl --context cluster-b get pods", 2)
  run("mcpx jira getJiraIssue --site acme --issue SHOP-34", 2)
  run("mcpx jira searchIssues --jql 'project = SHOP'", 1)
  run("mcpx github list_pull_requests --repo acme/store", 1)
  edit(`../../../../../var/folders/ab/x7k2q9/T/opencode-review/notes.md`, 3)
  edit("packages/api/src/customers.ts", 2)
  edit("packages/api/src/shopify.ts", 1)
  edit("packages/api/src/orders.ts", 1)
  edit("packages/web/context/auth.tsx", 1)
  edit("packages/web/context/cart.tsx", 1)
  edit("packages/web/app/checkout/page.tsx", 2)
  s.approve("https://docs.example.com/api", 3, "once", "webfetch", agent)
  s.approve("explore", 2, "once", "task", agent)
  s.approve("find . -name '*.md'", 1, "always", "bash", agent)
  s.approve("rg --files", 1, "always", "bash", agent)
  s.at(SAMPLE_NOW - 2 * hour)
  s.widen("tail", agent)
  s.widen("ls", agent)
  s.widen("mcpx db-local execute_sql", agent)
  /** Widened under the old family rule, which ended at `docker compose`: it answers nothing now. */
  s.widen("docker compose", agent)
  s.at(SAMPLE_NOW - 75 * 60_000)
  s.auto(`tail -4 ${ledger}`, 1, "bash", agent)
  s.at(SAMPLE_NOW - 30 * 60_000)
  s.auto(`ls -la ${review}`, 2, "bash", agent)
  s.auto(`../../../../../var/folders/ab/x7k2q9/T/opencode-review/notes.md`, 1, "edit", agent)
  s.auto(`ls -l ${review}`, 1, "bash", agent)
  s.auto(`tail -4 ${ledger}`, 1, "bash", agent)
  s.auto(`tail -10 ${ledger}`, 1, "bash", agent)
  s.auto("https://docs.example.com/api", 1, "webfetch", agent)
  s.at(SAMPLE_NOW - 2_000)
  s.pending("gh api --method PATCH /repos/acme/store/pulls/482 -f body=@body.md")
}

/** The `storefront` sample's events, as its ledger file would hold them, for a test project's ledger. */
export function storefrontEvents(): Event[] {
  const events: Event[] = []
  build(storefront, events)
  return events
}

/** A week of a project, as steps: rules earned early on, answered on most days since, the newest today. */
function week(s: Steps): void {
  const general = (line: string, times: number, how: "once" | "always" = "once") =>
    s.approve(line, times, how, "bash", "general")
  const hour = 3_600_000
  s.at(SAMPLE_NOW - 8 * DAY)
  s.approve("git status --short", 3)
  s.approve("echo trust-test", 3)
  s.approve("bun test", 3)
  s.approve("src/app.ts", 3, "once", "edit")
  general("ls -la", 3)
  general("head -30", 3)
  general("cat package.json", 2)
  s.widen("cat", "general")
  s.at(SAMPLE_NOW - 6 * DAY - 5 * hour)
  s.auto("git status --short", 1)
  s.at(SAMPLE_NOW - 4 * DAY - 3 * hour)
  s.auto("git status --short", 2)
  s.auto("ls -la", 1, "bash", "general")
  s.at(SAMPLE_NOW - 3 * DAY - 2 * hour)
  s.auto("bun test", 1)
  s.at(SAMPLE_NOW - 2 * DAY - 6 * hour)
  s.auto("git status --short", 3)
  s.auto("src/app.ts", 2, "edit")
  s.at(SAMPLE_NOW - DAY - 4 * hour)
  s.auto("echo trust-test", 2)
  s.at(SAMPLE_NOW - DAY + 2 * hour)
  general("head -40", 2)
  general("head -60", 2)
  general("head -80 README.md", 1)
  general("git status --short -uno", 2)
  s.approve("bun --version", 2)
  general("sleep 5", 1)
  s.approve("git push origin feat/trust", 5)
  general("find . -name '*.md'", 1, "always")
  general("sort -rn", 1, "always")
  for (const once of ["wc -l src/app.ts", "sed -n 1,40p src/app.ts", "pwd"]) s.approve(once, 1)
  s.at(SAMPLE_NOW - 50 * 60_000)
  s.auto("cat src/app.ts", 1, "bash", "general")
  s.at(SAMPLE_NOW - 20 * 60_000)
  s.auto("git status --short && echo trust-test", 1)
  s.at(SAMPLE_NOW - 12 * 60_000)
  s.auto("bun test", 1)
  s.at(SAMPLE_NOW - 3 * 60_000)
  s.auto("ls -la", 1, "bash", "general")
  s.auto("git status --short", 1)
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

  /**
   * A busy week, as the activity screen was designed from: rules earned over the week and answered
   * most days, a family widened by hand, commands one approval away, a dangerous one half way, and an
   * "always" given to OpenCode itself.
   */
  busy: () => ({ engine: build(week) }),

  /** Dangerous commands on their way: each needs eight in a row, and none of their families widens. */
  dangerous: () => ({
    engine: build((s) => {
      s.at(SAMPLE_NOW - 2 * DAY)
      s.approve("git status", 3)
      s.approve("git push origin feat/trust", 5)
      s.approve("rm -rf dist", 7)
      s.approve("docker compose -p prod down -v", 2)
      s.approve("kubectl delete pod web-0", 3, "once", "bash", "general")
      s.at(SAMPLE_NOW - 3_600_000)
      s.auto("git status", 2)
      s.at(SAMPLE_NOW - 2_000)
      s.pending("rm -rf dist")
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

  /** The project the ledger's redesign was drawn from: kinds, folders of edits, a long tail seen once. */
  storefront: () => ({ engine: build(storefront) }),

  /** The same afternoon, paused: the dialog has to say it before anything else. */
  "crowded-paused": () => {
    const engine = build(crowd)
    engine.load([{ v: 1, at: SAMPLE_NOW - 60_000, type: "paused" }])
    return { engine }
  },

  /** The busy week, paused: still learning, answering nothing — and every surface says so. */
  paused: () => {
    const engine = build(week)
    engine.load([{ v: 1, at: SAMPLE_NOW - 60_000, type: "paused" }])
    return { engine }
  },

  /** The ledger could not be written: the block speaks even with nothing else to say. */
  trouble: () => ({
    engine: build(() => {}),
    trouble: "ledger not saved: EACCES",
  }),
}
