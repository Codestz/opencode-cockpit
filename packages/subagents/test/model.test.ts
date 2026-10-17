import { describe, expect, test } from "bun:test"
import { createV1Translator } from "../src/core/adapt/v1.ts"
import { createV2Translator } from "../src/core/adapt/v2.ts"
import type { Change } from "../src/core/model/changes.ts"
import {
  activityOf,
  applyAll,
  type Entry,
  emptyModel,
  type Model,
  subagentsOf,
  toolTarget,
} from "../src/core/model/model.ts"
import { recorded } from "./fixtures.ts"

/**
 * The model against what OpenCode really sends: a main agent that launched one `explore` subagent to
 * read two files and grep for a name, recorded on 1.18.32 and 2.0.15. Both versions must come out as
 * the same subagent — that is the whole point of translating them into one vocabulary.
 */

const tools = (entries: readonly Entry[]) =>
  entries.filter((entry): entry is Extract<Entry, { kind: "tool" }> => entry.kind === "tool")

async function live(version: 1 | 2) {
  const { events, history } = await recorded(version)
  const unknown: string[] = []
  const note = (what: string, detail?: Record<string, unknown>) =>
    unknown.push(`${what} ${JSON.stringify(detail)}`)
  const translate = version === 1 ? createV1Translator(note) : createV2Translator(note)
  const changes: Change[] = events.flatMap((line) => translate.event(line.event, line.at))
  return { model: applyAll(emptyModel(), changes), unknown, parent: history.parent as string }
}

function onlySubagent(model: Model, parent: string) {
  const nodes = subagentsOf(model, parent)
  expect(nodes).toHaveLength(1)
  return nodes[0]?.session as NonNullable<(typeof nodes)[number]>["session"]
}

for (const version of [1, 2] as const) {
  describe(`OpenCode ${version}, live events`, () => {
    test("every event it sent is understood", async () => {
      const { unknown } = await live(version)
      expect(unknown).toEqual([])
    })

    test("the subagent hangs under the conversation that launched it, with its agent and task", async () => {
      const { model, parent } = await live(version)
      const sub = onlySubagent(model, parent)
      expect(sub.agent).toBe("explore")
      expect(sub.title.length).toBeGreaterThan(0)
      expect(sub.title).not.toContain("@explore")
      expect(sub.task).toMatch(/session/i)
      expect(sub.task).not.toStartWith("You are a subagent")
    })

    test("its tool calls, each with what it was about, all finished", async () => {
      const { model, parent } = await live(version)
      const calls = tools(onlySubagent(model, parent).entries)
      expect(calls.map((call) => call.name)).toEqual(expect.arrayContaining(["read", "grep"]))
      for (const call of calls) {
        expect(call.state).toBe("completed")
        expect(toolTarget(call.name, call.input).length).toBeGreaterThan(0)
        expect(call.ended).toBeGreaterThanOrEqual(call.at)
      }
      const read = calls.find((call) => call.name === "read")
      expect(toolTarget("read", read?.input ?? {})).toMatch(/src\/(session|middleware)\.ts/)
    })

    test("its thinking and its answer, streamed into whole text", async () => {
      const { model, parent } = await live(version)
      const entries = onlySubagent(model, parent).entries
      const thinking = entries.filter((entry) => entry.kind === "thinking")
      const reply = entries.filter(
        (entry): entry is Extract<Entry, { kind: "reply" }> => entry.kind === "reply",
      )
      expect(thinking.length).toBeGreaterThan(0)
      expect(reply.at(-1)?.text).toMatch(/createSession/)
      expect(reply.at(-1)?.done).toBe(true)
    })

    test("finished, with its usage", async () => {
      const { model, parent } = await live(version)
      const sub = onlySubagent(model, parent)
      expect(sub.status).toBe("done")
      expect(sub.tokens).toBeGreaterThan(0)
      expect(activityOf(sub).kind).toBe("done")
    })
  })
}

describe("a subagent that existed before Cockpit started", () => {
  /** Reopening a conversation: the same subagent, from stored messages instead of events. */
  test("OpenCode 1: children and stored messages give the same run", async () => {
    const { history } = await recorded(1)
    const translate = createV1Translator()
    const children = history.children as unknown[]
    const changes = [
      ...children.flatMap((info) => translate.session(info)),
      ...translate.history(history.messages as { info: unknown; parts: unknown[] }[]),
      { type: "status", id: history.child as string, status: "idle", at: Date.now() } satisfies Change,
    ]
    const model = applyAll(emptyModel(), changes)
    const sub = onlySubagent(model, history.parent as string)
    expect(sub.agent).toBe("explore")
    expect(sub.task).toMatch(/session/i)
    expect(tools(sub.entries).map((call) => call.name)).toEqual(expect.arrayContaining(["read", "grep"]))
    expect(sub.entries.some((entry) => entry.kind === "reply" && /createSession/.test(entry.text))).toBe(true)
    expect(sub.status).toBe("done")
  })

  test("OpenCode 2: the session list and loaded messages give the same run", async () => {
    const { history } = await recorded(2)
    const translate = createV2Translator()
    const child = history.child as string
    const changes = [
      ...(history.sessions as unknown[]).flatMap((info) => translate.session(info)),
      ...translate.history(child, history.messages as unknown[]),
      ...translate.status(child, history.status),
    ]
    const model = applyAll(emptyModel(), changes)
    const sub = onlySubagent(model, history.parent as string)
    expect(sub.agent).toBe("explore")
    expect(sub.task).toMatch(/session/i)
    expect(sub.task).not.toStartWith("You are a subagent")
    const calls = tools(sub.entries)
    expect(calls.map((call) => call.name)).toEqual(expect.arrayContaining(["read"]))
    expect(calls.every((call) => call.state === "completed" && call.ended !== undefined)).toBe(true)
    expect(sub.tokens).toBeGreaterThan(0)
    expect(sub.status).toBe("done")
  })
})

describe("what a subagent is doing now", () => {
  const at = 1_000
  const running = (entries: Change[]) =>
    applyAll(emptyModel(), [
      { type: "session", id: "c", parentID: "p", agent: "explore", at },
      { type: "status", id: "c", status: "busy", at },
      ...entries,
    ]).sessions.get("c")

  test("the call it is in the middle of, and what it is about", () => {
    const sub = running([
      {
        type: "tool",
        id: "c",
        call: "1",
        name: "grep",
        state: "running",
        input: { pattern: "session", include: "src/**" },
        at,
      },
    ])
    const activity = activityOf(sub as NonNullable<typeof sub>)
    expect(activity).toMatchObject({ kind: "tool", tool: "grep", text: '"session" src/**' })
  })

  test("thinking, then writing its answer", () => {
    const thinking = running([{ type: "thinking", id: "c", key: "r", delta: "hmm", at }])
    expect(activityOf(thinking as NonNullable<typeof thinking>).kind).toBe("thinking")
    const writing = running([{ type: "reply", id: "c", key: "t", delta: "The answer", at }])
    expect(activityOf(writing as NonNullable<typeof writing>).kind).toBe("writing")
  })

  test("held on a permission, then working again", () => {
    const waiting = running([{ type: "status", id: "c", status: "waiting", at }])
    expect(activityOf(waiting as NonNullable<typeof waiting>).kind).toBe("waiting")
  })

  test("a nested subagent sits under the one that launched it", () => {
    const model = applyAll(emptyModel(), [
      { type: "session", id: "a", parentID: "root", at: 1 },
      { type: "session", id: "b", parentID: "a", at: 2 },
      { type: "session", id: "c", parentID: "root", at: 3 },
    ])
    expect(subagentsOf(model, "root").map((node) => [node.session.id, node.depth])).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 0],
    ])
  })
})

/**
 * A permission a subagent is held on, from each OpenCode's own events (docs/opencode/permissions.md):
 * kept per session so the pane's card can answer it, gone once anyone answers it or the run ends.
 */
describe("held on a permission", () => {
  const at = 5_000
  /** A subagent at work, running a shell command it now has to ask about. */
  const working: Change[] = [
    { type: "session", id: "c", parentID: "p", agent: "general", title: "Fix the login test", at },
    { type: "status", id: "c", status: "busy", at },
    {
      type: "tool",
      id: "c",
      call: "call_1",
      name: "bash",
      state: "running",
      input: { command: "npm test" },
      at,
    },
  ]
  const v1Asked = (id: string, command: string) => ({
    type: "permission.asked",
    properties: {
      id,
      sessionID: "c",
      permission: "bash",
      patterns: [command],
      always: [`${command.split(" ")[0]} *`],
      metadata: {},
      tool: { messageID: "msg_1", callID: "call_1" },
    },
  })
  const v1Replied = (requestID: string) => ({
    type: "permission.replied",
    properties: { sessionID: "c", requestID, reply: "once" },
  })
  const v2Asked = (id: string, command: string) => ({
    name: "permission.asked",
    details: {
      data: {
        id,
        sessionID: "c",
        action: "shell",
        resources: [command],
        save: [`${command.split(" ")[0]} *`],
        metadata: {},
        message: "msg_1",
        source: { type: "tool", messageID: "msg_1", id: "call_1" },
      },
    },
  })
  const v2Replied = (requestID: string) => ({
    name: "permission.replied",
    details: { data: { sessionID: "c", requestID, reply: "once" } },
  })

  for (const version of [1, 2] as const) {
    const translate = () => (version === 1 ? createV1Translator() : createV2Translator())
    const asked = version === 1 ? v1Asked : v2Asked
    const replied = version === 1 ? v1Replied : v2Replied

    test(`OpenCode ${version}: an ask is kept with what it is for, and the run waits`, () => {
      const t = translate()
      const model = applyAll(emptyModel(), [...working, ...t.event(asked("per_1", "npm test"), at + 1)])
      const sub = model.sessions.get("c")
      expect(sub?.status).toBe("waiting")
      expect(sub?.pending).toEqual([
        {
          id: "per_1",
          sessionID: "c",
          permission: version === 1 ? "bash" : "shell",
          patterns: ["npm test"],
          always: ["npm *"],
          call: "call_1",
          message: "msg_1",
          at: at + 1,
        },
      ])
      expect(activityOf(sub as NonNullable<typeof sub>).text).toBe("waiting for permission")
    })

    test(`OpenCode ${version}: one of two answered still waits; both answered, it works again`, () => {
      const t = translate()
      const model = applyAll(emptyModel(), [
        ...working,
        ...t.event(asked("per_1", "npm test"), at + 1),
        ...t.event(asked("per_2", "npm run lint"), at + 2),
        ...t.event(replied("per_1"), at + 3),
      ])
      const sub = model.sessions.get("c")
      expect(sub?.pending.map((ask) => ask.id)).toEqual(["per_2"])
      expect(sub?.status).toBe("waiting")
      applyAll(model, t.event(replied("per_2"), at + 4))
      expect(sub?.pending).toEqual([])
      expect(sub?.status).toBe("running")
    })
  }

  test("a run that ends drops what it was held on", () => {
    for (const end of [
      { type: "status", id: "c", status: "idle", at: at + 9 },
      { type: "status", id: "c", status: "failed", error: "aborted", at: at + 9 },
    ] as Change[]) {
      const model = applyAll(emptyModel(), [
        ...working,
        ...createV1Translator().event(v1Asked("per_1", "npm test"), at + 1),
        end,
      ])
      expect(model.sessions.get("c")?.pending).toEqual([])
    }
  })

  test("an answer to a request asked before we loaded still frees the run", () => {
    const model = applyAll(emptyModel(), [
      ...working,
      { type: "status", id: "c", status: "waiting", at: at + 1 },
      ...createV2Translator().event(v2Replied("per_old"), at + 2),
    ])
    expect(model.sessions.get("c")?.status).toBe("running")
  })

  test("both OpenCodes name the model, whose it is and its variant", () => {
    const v1 = createV1Translator().session({
      id: "c",
      title: "Fix it (@general subagent)",
      model: { id: "space-bunny-free", providerID: "opencode", variant: "high" },
    })
    const v2 = createV2Translator().event(
      {
        name: "session.step.started",
        details: { data: { sessionID: "c", agent: "general", model: { id: "gpt-5", providerID: "openai" } } },
      },
      at,
    )
    expect(applyAll(emptyModel(), v1).sessions.get("c")).toMatchObject({
      model: "space-bunny-free",
      provider: "opencode",
      variant: "high",
    })
    expect(applyAll(emptyModel(), v2).sessions.get("c")).toMatchObject({ model: "gpt-5", provider: "openai" })
  })
})
