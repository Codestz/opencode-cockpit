/**
 * Widening a family: only a person does it, and what it answers is narrower than its name — never a
 * dangerous command, a write to a file, another program, an opaque line, or anything config holds.
 */
import { describe, expect, test } from "bun:test"
import { createEngine } from "../src/core/engine.ts"
import type { Request } from "../src/core/keys.ts"
import { applyAll, DAY, type Event, emptyState, keyOf, parseLines, serialize } from "../src/core/ledger.ts"
import { decide } from "../src/core/policy.ts"
import { rulesFrom } from "../src/core/rules.ts"
import { rowText } from "../src/core/view/rows.ts"
import { sidebarRows } from "../src/core/view/sidebar.ts"

const ROOT = "/work/app"
const SETTINGS = { threshold: 3, dangerExtra: 5, expireDays: 30 }
const FOLD = { expireMs: 30 * DAY }
const OPEN = rulesFrom({ permission: { bash: "ask" } })

const widened = (family: string, agent = "general", at = 1, permission = "bash"): Event => ({
  v: 1,
  at,
  type: "widened",
  permission,
  agent,
  family,
})
const unwidened = (family: string, agent = "general", at = 2): Event => ({
  v: 1,
  at,
  type: "unwidened",
  permission: "bash",
  agent,
  family,
})

let n = 0
function ask(
  line: string,
  events: readonly Event[],
  options: { agent?: string; rules?: ReturnType<typeof rulesFrom>; permission?: string } = {},
) {
  n++
  const permission = options.permission ?? "bash"
  const request: Request = {
    id: `per_${n}`,
    sessionID: "ses_1",
    permission,
    patterns: [line],
    always: [],
  }
  return decide({
    request,
    context: { line, root: ROOT },
    agent: options.agent ?? "general",
    rules: options.rules ?? OPEN,
    state: applyAll(emptyState(), events, FOLD),
    settings: SETTINGS,
    now: 10,
  })
}

describe("the policy for a widened family", () => {
  test("a variant never approved is answered, and says which family answered", () => {
    const judged = ask("ls -R docs", [widened("ls")])
    expect(judged.answer).toBe(true)
    expect(judged.why).toBe("in a family you widened: any ls …")
    expect(judged.items).toEqual([{ subject: "ls -R docs", via: "ls" }])
  })

  test("for every agent: a widening is the project's, whoever it was widened while", () => {
    expect(ask("ls -la", [widened("ls")], { agent: "build" }).answer).toBe(true)
  })

  test("not another family, nor the same words somewhere else or as root", () => {
    expect(ask("sudo ls", [widened("ls")]).answer).toBe(false)
    expect(ask("cd web && ls", [widened("ls")]).answer).toBe(false)
    expect(ask("lsof -i", [widened("ls")]).answer).toBe(false)
  })

  test("an opaque line still asks", () => {
    const judged = ask("ls $(cat dirs)", [widened("ls")])
    expect(judged.answer).toBe(false)
    expect(judged.items).toEqual([])
  })

  test("a redirect that writes a file still asks; one that writes nothing does not", () => {
    expect(ask("ls > out.txt", [widened("ls")]).answer).toBe(false)
    expect(ask("ls >> out.txt", [widened("ls")]).answer).toBe(false)
    expect(ask("ls 2> /dev/null", [widened("ls")]).answer).toBe(true)
    expect(ask("ls 2>&1", [widened("ls")]).answer).toBe(true)
  })

  test("a dangerous command in a safe family still asks", () => {
    expect(ask("docker compose -p dev down", [widened("docker compose -p dev down")]).answer).toBe(true)
    expect(ask("docker compose -p dev down -v", [widened("docker compose -p dev down")]).answer).toBe(false)
  })

  test("every command on the line must be covered", () => {
    expect(ask("ls -la && ls src", [widened("ls")]).answer).toBe(true)
    expect(ask("ls -la && cat x", [widened("ls")]).answer).toBe(false)
  })

  test("config's specific ask still wins over a widening", () => {
    const rules = rulesFrom({ permission: { bash: { "*": "ask", "ls -R *": "ask" } } })
    const judged = ask("ls -R docs", [widened("ls")], { rules })
    expect(judged.answer).toBe(false)
    expect(judged.why).toBe('you asked to be asked: "ls -R *": "ask"')
  })

  test("paused, a widening answers nothing either", () => {
    expect(ask("ls -la", [widened("ls"), { v: 1, at: 3, type: "paused" }]).answer).toBe(false)
  })

  test("an edit family answers files in its folder, not its subfolders", () => {
    const events = [widened("src/", "general", 1, "edit")]
    expect(ask("src/new.ts", events, { permission: "edit" }).answer).toBe(true)
    expect(ask("src/view/rows.ts", events, { permission: "edit" }).answer).toBe(false)
    expect(ask("test/a.ts", events, { permission: "edit" }).answer).toBe(false)
  })

  test("un-widened, every command stands on its own count again", () => {
    expect(ask("ls -la", [widened("ls"), unwidened("ls")]).answer).toBe(false)
    expect(ask("ls -la", [widened("ls"), unwidened("ls"), widened("ls", "general", 3)]).answer).toBe(true)
  })
})

describe("widenings in the ledger file", () => {
  test("replayed in order: widened, un-widened, widened again for another agent", () => {
    const state = applyAll(
      emptyState(),
      [widened("ls"), unwidened("ls"), widened("ls", "build", 5), widened("git status", "general", 6)],
      FOLD,
    )
    expect([...state.widened.keys()].sort()).toEqual(
      [keyOf("bash", "ls"), keyOf("bash", "git status")].sort(),
    )
    expect(state.widened.get(keyOf("bash", "ls"))?.at).toBe(5)
  })

  test("written and read back whole; a torn last line is waited for, not lost", () => {
    const text = serialize(widened("ls")) + serialize(unwidened("ls", "general", 2))
    const torn = serialize(widened("echo", "general", 3)).slice(0, 20)
    const { events, rest } = parseLines(text + torn)
    expect(events.map((event) => event.type)).toEqual(["widened", "unwidened"])
    expect(rest).toBe(torn)
  })

  test("a line cut by a crash is skipped, and the widening after it recovered", () => {
    const cut = serialize(widened("echo")).slice(0, 25)
    const { events } = parseLines(`${cut}${serialize(widened("ls", "general", 9))}`)
    expect(events).toEqual([widened("ls", "general", 9)])
  })

  test("a widening missing its family is ignored", () => {
    const { events } = parseLines(
      `${JSON.stringify({ v: 1, at: 1, type: "widened", permission: "bash", agent: "x" })}\n`,
    )
    expect(events).toEqual([])
  })
})

describe("an answer through a widening", () => {
  test("is logged with the family that answered, and the sidebar says so", () => {
    const engine = createEngine({ ...SETTINGS, keep: 5 })
    engine.load([widened("ls")])
    const request: Request = {
      id: "per_x",
      sessionID: "s",
      permission: "bash",
      patterns: ["ls -x"],
      always: [],
    }
    const { judgement } = engine.ask({
      request,
      context: { line: "ls -x", root: ROOT },
      agent: "general",
      rules: OPEN,
      at: 100,
    })
    expect(judgement.answer).toBe(true)
    const auto = engine.answered("per_x", 120)
    expect(auto).toMatchObject({
      type: "auto",
      rule: "in a family you widened: any ls …",
      items: [{ subject: "ls -x", via: "ls" }],
    })
    if (auto) engine.load([auto])
    expect(engine.recent()[0]?.via).toBe("ls")
    const rows = sidebarRows({
      width: 36,
      recent: engine.recent(),
      count: engine.count(),
      pending: engine.pending(),
      state: engine.state,
      limit: 3,
    })
    expect(rows.map((row) => rowText(row).trimEnd())).toContain("● ls -x · any ls                  1×")
  })
})
