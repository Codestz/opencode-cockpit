/**
 * Trust: its own engine, run live. `live()` starts from a session where a few commands are already
 * trusted; the page then asks, approves and asks again through the same calls OpenCode's events
 * drive, and draws the sidebar block and ctrl+x p from what the engine made of them.
 */
import { createEngine } from "../../../packages/trust/src/core/engine.ts"
import type { Request } from "../../../packages/trust/src/core/keys.ts"
import { rulesFrom } from "../../../packages/trust/src/core/rules.ts"
import { SAMPLE_NOW, SAMPLE_ROOT, SAMPLE_SETTINGS, SAMPLES } from "../../../packages/trust/src/core/sample.ts"
import { activityRows } from "../../../packages/trust/src/core/view/activity.ts"
import { explorerRows } from "../../../packages/trust/src/core/view/explorer.ts"
import { sidebarRows } from "../../../packages/trust/src/core/view/sidebar.ts"

const RULES = rulesFrom({ permission: { bash: { "*": "ask" }, edit: "ask" } })

export function live() {
  const engine = createEngine(SAMPLE_SETTINGS)
  let clock = SAMPLE_NOW - 3_600_000
  let n = 0
  /** The agent asks; Trust judges. Answered by Trust, or left to you as a pending prompt. */
  const ask = (line: string) => {
    const request: Request = {
      id: `per_site_${++n}`,
      sessionID: "ses_site",
      permission: "bash",
      patterns: [line],
      always: [`${line.split(" ").slice(0, 2).join(" ")} *`],
      call: `call_${n}`,
    }
    const { judgement, event } = engine.ask({ request, context: { line, root: SAMPLE_ROOT }, agent: "build", rules: RULES, at: clock })
    engine.load([event])
    clock += 1_500
    if (judgement.answer) {
      const answered = engine.answered(request.id, clock)
      if (answered) engine.load([answered])
      engine.replied({ requestID: request.id, reply: "once", at: clock + 5 })
    }
    return { id: request.id, answered: judgement.answer, why: judgement.why, progress: judgement.progress }
  }
  /** You pressed "allow once". */
  const approve = (id: string) => {
    clock += 2_000
    engine.load(engine.replied({ requestID: id, reply: "once", at: clock }).events)
    clock += 40_000
  }
  // what was earned before the page opened: two commands this session trusts already
  for (const line of ["git status --short", "ls -la"])
    for (let i = 0; i < 3; i++) approve(ask(line).id)
  for (let i = 0; i < 4; i++) ask("git status --short")

  return {
    ask,
    approve,
    now: () => clock,
    sidebar: (width: number) =>
      sidebarRows({ width, recent: engine.recent(), count: engine.count(), pending: engine.pending(), state: engine.state, limit: 4 } as never),
    activity: (width: number, height: number) =>
      activityRows({ state: engine.state, settings: SAMPLE_SETTINGS, now: clock, history: engine.history, width, height, project: "app" } as never).rows,
  }
}

/** A finished afternoon from the product's samples, for a settled frame. */
export function activity(name: string, width: number, height: number) {
  const { engine } = SAMPLES[name]()
  return activityRows({ state: engine.state, settings: SAMPLE_SETTINGS, now: SAMPLE_NOW, history: engine.history, width, height, project: "app" } as never).rows
}

/**
 * The ledger (l in ctrl+x p): every family and command Trust has seen, and a card for the one under
 * the cursor. `step` walks the cursor down the tree, opening the family it is in.
 */
export function ledger(name: string, width: number, height: number, step: number) {
  const { engine } = SAMPLES[name]()
  const reading = { state: engine.state, settings: SAMPLE_SETTINGS, now: SAMPLE_NOW, history: engine.history, width, height, project: "app" }
  const first = explorerRows({ ...reading, open: new Set(), full: new Set(), filter: "" } as never) as { model: { nodes: { key: string; kind: string; family?: { key: string } }[] } }
  const nodes = first.model.nodes.filter((node) => node.kind === "family" || node.kind === "command")
  const node = nodes[step % Math.max(1, nodes.length)]
  const open = new Set(node?.family ? [node.family.key] : [])
  return explorerRows({ ...reading, open, full: new Set(), filter: "", ...(node ? { selected: node.key } : {}) } as never).rows
}
