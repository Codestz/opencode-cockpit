/**
 * Trust end to end, without OpenCode: requests asked, replies arriving, the events written and read
 * back — the loop the interface runs, with the clock in the test's hands.
 */
import { describe, expect, test } from "bun:test"
import { createEngine, credit, type Engine, PERSON_MS } from "../src/core/engine.ts"
import type { Request } from "../src/core/keys.ts"
import { DAY } from "../src/core/ledger.ts"
import { type ConfigRule, rulesFrom } from "../src/core/rules.ts"

const ROOT = "/work/app"
const ASK_ALL = rulesFrom({ permission: { bash: "ask" } })
const SETTINGS = { threshold: 3, dangerExtra: 5, expireDays: 30 }

let n = 0
/** A world: one engine, a clock, and a ledger the engine writes to and reads back. */
function world(rules: readonly ConfigRule[] = ASK_ALL) {
  const engine: Engine = createEngine(SETTINGS)
  let clock = 1_000_000
  const written: unknown[] = []
  const write = (events: unknown[]) => {
    written.push(...events)
    engine.load(events as never)
  }

  const ask = (line: string, options: { agent?: string; permission?: string; patterns?: string[] } = {}) => {
    n++
    clock += 5_000
    const request: Request = {
      id: `per_${n}`,
      sessionID: "ses_1",
      permission: options.permission ?? "bash",
      patterns: options.patterns ?? [line],
      always: [],
      call: `call_${n}`,
    }
    const { judgement, event } = engine.ask({
      request,
      context: { line, root: ROOT },
      agent: options.agent ?? "build",
      rules,
      at: clock,
    })
    write([event])
    return { id: request.id, judgement }
  }

  /** A person answering after `after` ms; or, for an answer Trust gave, its reply coming back. */
  const reply = (id: string, how: "once" | "always" | "reject" = "once", after = 1_500) => {
    clock += after
    const { events, credit } = engine.replied({ requestID: id, reply: how, at: clock })
    write(events)
    return credit
  }

  /** What the interface does on a judgement to answer: reply, then record it. */
  const answer = (id: string) => {
    clock += 20
    const event = engine.answered(id, clock)
    if (event) write([event])
    return reply(id, "once", 5)
  }

  /** Approve `line` by hand `times` times. */
  const approve = (line: string, times: number, options: { agent?: string } = {}) => {
    for (let i = 0; i < times; i++) {
      const { id, judgement } = ask(line, options)
      expect(judgement.answer).toBe(false)
      reply(id)
    }
  }

  return {
    engine,
    ask,
    reply,
    answer,
    approve,
    written,
    advance: (ms: number) => {
      clock += ms
    },
  }
}

describe("earning trust", () => {
  test("three approvals in a row, and the fourth is answered", () => {
    const w = world()
    w.approve("git status", 3)
    const { id, judgement } = w.ask("git status")
    expect(judgement.answer).toBe(true)
    expect(judgement.why).toBe("approved by you 3× in a row")
    expect(w.answer(id)).toEqual({ kind: "ignored", why: "answered by Trust" })
    expect(w.engine.count()).toBe(1)
    expect(w.engine.recent()[0]?.label).toBe("git status")
  })

  test("a reject resets the count", () => {
    const w = world()
    w.approve("bun test", 2)
    const { id } = w.ask("bun test")
    w.reply(id, "reject")
    w.approve("bun test", 2)
    expect(w.ask("bun test").judgement.answer).toBe(false)
    w.reply(w.ask("bun test").id)
  })

  test("Trust's own answers never count as yours", () => {
    const w = world()
    w.approve("ls", 3)
    for (let i = 0; i < 4; i++) w.answer(w.ask("ls").id)
    const entry = [...w.engine.state.entries.values()][0]
    expect(entry?.streak).toBe(3)
    expect(entry?.autos).toBe(4)
  })

  test("a reply under 300ms is not a person's — OpenCode's --auto looks just like this", () => {
    const w = world()
    for (let i = 0; i < 5; i++) {
      const { id } = w.ask("pwd")
      expect(w.reply(id, "once", PERSON_MS - 1).kind).toBe("ignored")
    }
    expect(w.ask("pwd").judgement.answer).toBe(false)
    expect(w.written.some((event) => (event as { type: string }).type === "approved")).toBe(false)
  })

  test("a reply to a request asked before Trust was watching is not counted", () => {
    expect(credit({ reply: "once", repliedAt: 10_000, ours: false })).toEqual({
      kind: "ignored",
      why: "asked before Trust was watching",
    })
    expect(credit({ reply: "reject", repliedAt: 10_000, ours: false })).toEqual({ kind: "rejected" })
  })

  test("trust unused past the expiry has to be earned again", () => {
    const w = world()
    w.approve("git fetch", 3)
    w.advance(31 * DAY)
    expect(w.ask("git fetch").judgement).toMatchObject({ answer: false, why: "0/3 approvals in a row" })
  })
})

describe("what is the same thing", () => {
  test("`-p cockpit up` and `-p prod down -v` never share trust", () => {
    const w = world()
    w.approve("docker compose -p cockpit up -d", 3)
    expect(w.ask("docker compose -p cockpit up -d").judgement.answer).toBe(true)
    const prod = w.ask("docker compose -p prod down -v").judgement
    expect(prod.answer).toBe(false)
    expect(prod.progress).toEqual([
      {
        subject: "docker compose -p prod down -v",
        danger: "compose down -v",
        have: 0,
        need: 8,
        trusted: false,
      },
    ])
  })

  test("the agent is part of it", () => {
    const w = world()
    w.approve("git status", 3, { agent: "build" })
    expect(w.ask("git status", { agent: "general" }).judgement.answer).toBe(false)
    expect(w.ask("git status", { agent: "build" }).judgement.answer).toBe(true)
  })

  test("so is where it runs", () => {
    const w = world()
    w.approve("rm -rf dist", 8)
    expect(w.ask("rm -rf dist").judgement.answer).toBe(true)
    expect(w.ask("cd /tmp && rm -rf dist").judgement.answer).toBe(false)
  })

  test("a dangerous command needs threshold + extra", () => {
    const w = world()
    w.approve("git push", 7)
    expect(w.ask("git push").judgement).toMatchObject({ answer: false, why: "7/8 approvals in a row" })
    w.approve("git push", 1)
    expect(w.ask("git push").judgement.answer).toBe(true)
  })
})

describe("config", () => {
  test("a specific pattern set to ask is never answered, and nothing is counted", () => {
    const rules = rulesFrom({ permission: { bash: { "*": "ask", "git push *": "ask" } } })
    const w = world(rules)
    for (let i = 0; i < 10; i++) {
      const { id, judgement } = w.ask("git push origin main")
      expect(judgement).toMatchObject({ answer: false, why: 'you asked to be asked: "git push *": "ask"' })
      w.reply(id)
    }
    expect(w.engine.state.entries.size).toBe(0)
  })

  test("the catch-all ask is Trust's to fill", () => {
    const w = world(rulesFrom({ permission: { bash: { "*": "ask" } } }))
    w.approve("bun run build", 3)
    expect(w.ask("bun run build").judgement.answer).toBe(true)
  })

  test("a specific ask in OpenCode's own patterns holds even where our reading differs", () => {
    const rules = rulesFrom({ permission: { bash: { "*": "ask", "git push *": "ask" } } })
    const w = world(rules)
    const { judgement } = w.ask("git status", { patterns: ["git status", "git push"] })
    expect(judgement.answer).toBe(false)
  })

  test("a command config allows is not counted, and does not hold the rest", () => {
    const rules = rulesFrom({ permission: { bash: { "*": "ask", "git status": "allow" } } })
    const w = world(rules)
    w.approve("git status && bun test", 3)
    const { judgement } = w.ask("git status && bun test")
    expect(judgement.answer).toBe(true)
    expect(judgement.items).toEqual([{ subject: "bun test" }])
  })
})

describe("a line is approved whole or not at all", () => {
  test("one untrusted command in a line is enough to ask", () => {
    const w = world()
    w.approve("git status", 3)
    const { judgement } = w.ask("git status && rm -rf build")
    expect(judgement.answer).toBe(false)
    expect(judgement.why).toBe("1 of 2 not yet trusted (rm -rf build 0/8)")
  })

  test("an approval of a line counts for each of its commands", () => {
    const w = world()
    w.approve("git add -A && git commit -m wip", 3)
    expect(w.ask("git add -A").judgement.answer).toBe(true)
    expect(w.ask("git commit -m wip").judgement.answer).toBe(true)
  })

  test("a line that cannot be read is asked, and counts for nothing", () => {
    const w = world()
    for (let i = 0; i < 4; i++) w.reply(w.ask("rm -rf $DIR").id)
    const { judgement } = w.ask("rm -rf $DIR")
    expect(judgement).toMatchObject({ answer: false, items: [] })
    expect(w.engine.state.entries.size).toBe(0)
  })

  test("never: external_directory and doom_loop", () => {
    const w = world(rulesFrom({ permission: "ask" }))
    for (const permission of ["external_directory", "doom_loop"]) {
      for (let i = 0; i < 4; i++) w.reply(w.ask("", { permission, patterns: ["/etc/*"] }).id)
      expect(w.ask("", { permission, patterns: ["/etc/*"] }).judgement.answer).toBe(false)
    }
  })
})

describe("other permissions", () => {
  test("webfetch by host", () => {
    const w = world(rulesFrom({ permission: "ask" }))
    for (const path of ["a", "b", "c"])
      w.reply(w.ask("", { permission: "webfetch", patterns: [`https://docs.x.dev/${path}`] }).id)
    expect(
      w.ask("", { permission: "webfetch", patterns: ["https://docs.x.dev/other"] }).judgement.answer,
    ).toBe(true)
    expect(w.ask("", { permission: "webfetch", patterns: ["https://evil.example/"] }).judgement.answer).toBe(
      false,
    )
  })

  test("v2's names count as v1's", () => {
    const w = world(rulesFrom({ permission: "ask" }))
    for (let i = 0; i < 3; i++) w.reply(w.ask("", { permission: "edit", patterns: ["src/a.ts"] }).id)
    expect(w.ask("", { permission: "edit", patterns: ["src/a.ts"] }).judgement.answer).toBe(true)
  })
})

describe("pause and always", () => {
  test("paused, Trust still learns but does not answer", () => {
    const w = world()
    w.engine.load([{ v: 1, at: 1, type: "paused" }])
    w.approve("ls", 3)
    expect(w.ask("ls").judgement).toMatchObject({ answer: false, why: "Trust is paused in this project" })
    w.engine.load([{ v: 1, at: 2, type: "resumed" }])
    expect(w.ask("ls").judgement.answer).toBe(true)
  })

  test("an always given to OpenCode is recorded, even for a line Trust could not read", () => {
    const w = world()
    n++
    const request: Request = {
      id: `per_${n}`,
      sessionID: "ses_1",
      permission: "bash",
      patterns: ["echo $HOME"],
      always: ["echo *"],
    }
    w.engine.ask({
      request,
      context: { line: "echo $HOME", root: ROOT },
      agent: "build",
      rules: ASK_ALL,
      at: 0,
    })
    const { events } = w.engine.replied({ requestID: request.id, reply: "always", at: 2_000 })
    w.engine.load(events)
    expect(w.engine.state.always[0]?.patterns).toEqual(["echo *"])
  })

  test("our reply's echo may come before our call returns: still ours, still recorded", () => {
    const w = world()
    w.approve("ls", 3)
    const { id } = w.ask("ls")
    expect(w.reply(id, "once", 5)).toEqual({ kind: "ignored", why: "answered by Trust" })
    expect(w.engine.answered(id, 2_000_000)?.type).toBe("auto")
    expect(w.engine.count()).toBe(1)
    expect(w.engine.pending()).toEqual([])
  })

  test("a failed reply of ours leaves the person's answer to count", () => {
    const w = world()
    w.approve("ls", 3)
    const { id, judgement } = w.ask("ls")
    expect(judgement.answer).toBe(true)
    w.engine.failed(id)
    expect(w.reply(id).kind).toBe("approved")
  })

  test("requests answered elsewhere leave the pending list", () => {
    const w = world()
    const { id } = w.ask("ls")
    w.ask("pwd")
    w.engine.reconcile(new Set([id]))
    expect(w.engine.pending().map((p) => p.request.id)).toEqual([id])
  })
})
