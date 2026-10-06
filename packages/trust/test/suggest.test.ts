/**
 * Suggestions (#45): when one agent's approvals across a family reach the threshold, the ledger offers
 * `w` for it — once, until widened or dismissed. Never for a dangerous family, never by itself.
 */
import { describe, expect, test } from "bun:test"
import { ANY_AGENT, applyAll, DAY, type Event, emptyState } from "../src/core/ledger.ts"
import { parse } from "../src/core/shell.ts"
import { signature } from "../src/core/signature.ts"
import { suggestionsOf } from "../src/core/suggest.ts"
import { dismiss } from "../src/core/view/actions.ts"
import { familiesOf, type Reading } from "../src/core/view/model.ts"
import { explorerModel } from "../src/core/view/tree.ts"

const ROOT = "/work/app"
const SETTINGS = { threshold: 3, dangerExtra: 5, expireDays: 30 }
const FOLD = { expireMs: 30 * DAY, threshold: 3 }

const sub = (line: string) => {
  const parsed = parse(line)
  if (parsed.kind !== "commands") throw new Error(line)
  return signature(parsed.commands[0] as never, ROOT)
}

let n = 0
const approve = (line: string, agent = "build", danger?: string): Event => {
  n++
  return {
    v: 1,
    at: n,
    type: "approved",
    request: `per_${n}`,
    session: "ses_1",
    permission: "bash",
    agent,
    items: [{ subject: sub(line), ...(danger ? { danger } : {}) }],
  }
}

const LOCAL = [
  'mcpx db-local execute_sql --sql "select 1"',
  'mcpx db-local execute_sql --sql "select count(*) from users"',
  'mcpx db-local execute_sql --sql "select id from orders limit 5"',
]

const readingOf = (events: readonly Event[]): Reading => ({
  state: applyAll(emptyState(), events, FOLD),
  settings: SETTINGS,
  now: n + 1,
})
const suggest = (events: readonly Event[]) => {
  const reading = readingOf(events)
  return suggestionsOf(reading, familiesOf(reading))
}

describe("what is suggested", () => {
  test("three approvals across three commands of one family", () => {
    const found = suggest(LOCAL.map((line) => approve(line)))
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ approvals: 3, commands: 3 })
    expect(found[0]?.family.family).toBe("mcpx db-local execute_sql")
  })

  test("one command approved again and again is its own count's business, not a family's", () => {
    const line = LOCAL[0] as string
    expect(suggest([approve(line), approve(line), approve(line)])).toHaveLength(0)
  })

  test("below the threshold: nothing yet", () =>
    expect(suggest(LOCAL.slice(0, 2).map((line) => approve(line)))).toHaveLength(0))

  test("a dangerous family never is: production", () => {
    const prod = LOCAL.map((line) => approve(line.replace("db-local", "db-prod"), "build", "production"))
    expect(suggest(prod)).toHaveLength(0)
  })

  test("a dangerous family never is: git push", () => {
    const push = ["git push origin a", "git push origin b", "git push origin c"].map((line) =>
      approve(line, "build", "git push"),
    )
    expect(suggest(push)).toHaveLength(0)
  })

  test("a family already widened is not suggested", () => {
    const widened: Event = {
      v: 1,
      at: 0,
      type: "widened",
      permission: "bash",
      agent: "build",
      family: "mcpx db-local execute_sql",
    }
    expect(suggest([widened, ...LOCAL.map((line) => approve(line))])).toHaveLength(0)
  })

  test("a family Trust learned is not suggested", () =>
    expect(suggest(["head a", "head b", "head c"].map((line) => approve(line)))).toHaveLength(0))

  test("dismissed, it is not suggested again", () => {
    const dismissed: Event = {
      v: 1,
      at: 99,
      type: "dismissed",
      permission: "bash",
      agent: "build",
      family: "mcpx db-local execute_sql",
    }
    expect(suggest([...LOCAL.map((line) => approve(line)), dismissed])).toHaveLength(0)
  })

  test("approvals by different agents add up: the project's family, one suggestion", () => {
    const events = [
      approve(LOCAL[0] as string),
      approve(LOCAL[1] as string, "general"),
      approve(LOCAL[2] as string, "explore"),
    ]
    expect(suggest(events)).toHaveLength(1)
  })

  test("however many agents reach it, it is suggested once", () => {
    const events = [...LOCAL.map((line) => approve(line)), ...LOCAL.map((line) => approve(line, "general"))]
    expect(suggest(events)).toHaveLength(1)
  })
})

describe("dismiss", () => {
  test("a suggestion's family: one dismissed event, for the project", () => {
    const reading = readingOf(LOCAL.map((line) => approve(line)))
    const [suggestion] = suggestionsOf(reading, familiesOf(reading))
    if (!suggestion) throw new Error("no suggestion")
    const outcome = dismiss({ kind: "family", family: suggestion.family, suggested: true }, 50)
    expect(outcome.events).toEqual([
      {
        v: 1,
        at: 50,
        type: "dismissed",
        permission: "bash",
        agent: ANY_AGENT,
        family: "mcpx db-local execute_sql",
      },
    ])
  })

  test("anything else: nothing written", () => {
    const reading = readingOf(LOCAL.map((line) => approve(line)))
    const family = familiesOf(reading)[0]
    if (!family) throw new Error("no family")
    expect(dismiss({ kind: "family", family }, 50).events).toEqual([])
    expect(dismiss(undefined, 50).events).toEqual([])
  })
})

describe("in the ledger", () => {
  const reading = () => readingOf(LOCAL.map((line) => approve(line)))

  test("suggestions come first, under their own heading", () => {
    const model = explorerModel({ ...reading(), open: new Set(), full: new Set(), filter: "" })
    expect(model.lines[0]).toEqual({ kind: "heading", section: "suggested" })
    expect(model.nodes[0]?.kind).toBe("suggest")
  })

  test("a filter shows what matches, not suggestions", () => {
    const model = explorerModel({ ...reading(), open: new Set(), full: new Set(), filter: "mcpx" })
    expect(model.nodes.some((node) => node.kind === "suggest")).toBe(false)
    expect(model.lines.some((line) => line.kind === "heading" && line.section === "suggested")).toBe(false)
  })
})
