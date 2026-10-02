import { describe, expect, test } from "bun:test"
import type { ToolContext, ToolDefinition } from "@opencode-ai/plugin"
import { silentLog } from "@opencode-cockpit/client/log"
import type { ServerHost, ServerParts } from "@opencode-cockpit/client/server"
import { createSubagentsServer } from "../src/agent/plugin.ts"
import { backgroundOffered, subagentsGuidance } from "../src/core/view/guidance.ts"

/**
 * The agent side as the main agent meets it: a fake OpenCode 1 host holding the load test's runs
 * (2026-09-30 → 10-01, opencode.db), the tools called as the model calls them.
 */

const ROOT = "ses_main"
const PLAN = "ses_plan"
const FLAKY = "ses_flaky"
const DAY = 24 * 60 * 60 * 1000
/** The load test's second day: the main agent continued yesterday's subagents. */
const T0 = Date.parse("2026-09-30T22:25:08")
const T1 = T0 + DAY

const userMessage = (session: string, id: string, at: number, text: string) => ({
  info: { id, sessionID: session, role: "user", time: { created: at } },
  parts: [{ id: `${id}p`, sessionID: session, messageID: id, type: "text", text }],
})
const answer = (session: string, id: string, at: number, text: string, done: number, error?: unknown) => ({
  info: {
    id,
    sessionID: session,
    role: "assistant",
    modelID: "mimo",
    time: { created: at, completed: done },
    ...(error ? { error } : {}),
  },
  parts: [{ id: `${id}p`, sessionID: session, messageID: id, type: "text", text, time: { end: done } }],
})
const ABORTED = { name: "MessageAbortedError", data: { message: "Aborted" } }

/** The store: what `session.children` and `session.messages` answer. */
const store: Record<string, { info: Record<string, unknown>; messages: unknown[] }> = {
  [FLAKY]: {
    info: {
      id: FLAKY,
      parentID: ROOT,
      title: "Flaky shell starter (@general subagent)",
      /** As 1.18.32 stored the load test's: the launcher's agent, not the subagent's. */
      agent: "build",
      time: { created: T0 - 6 * 60_000, updated: T0 - 4 * 60_000 },
    },
    messages: [
      userMessage(FLAKY, "f1", T0 - 6 * 60_000, "Start ONE background shell and then finish immediately."),
      answer(FLAKY, "f2", T0 - 6 * 60_000, "Started sh_ch6u4lz4.", T0 - 4 * 60_000),
    ],
  },
  [PLAN]: {
    info: {
      id: PLAN,
      parentID: ROOT,
      title: "Write a long plan (@general subagent)",
      agent: "general",
      time: { created: T0, updated: T1 + 4 * 60_000 },
    },
    messages: [
      userMessage(PLAN, "p1", T0, "Write a long plan into PLAN.md."),
      answer(PLAN, "p2", T0 + 1000, "# The plan\nAll written to PLAN.md.", T0 + 8 * 60_000),
      userMessage(PLAN, "p3", T1, "Explore the repository and list every file."),
      answer(PLAN, "p4", T1 + 1000, "", T1 + 4 * 60_000, ABORTED),
    ],
  },
}

function host(): ServerHost {
  return {
    version: 1,
    directory: "/work",
    scope: {},
    log: silentLog,
    readFile: async () => undefined,
    session: {
      get: async (id) => store[id]?.info as { parentID?: string; title?: string } | undefined,
      busy: async () => false,
      notify: async () => {},
      children: async (id) =>
        Object.values(store)
          .filter((each) => each.info.parentID === id)
          .map((each) => each.info as { id: string }),
      messages: async (id) => (store[id]?.messages ?? []) as { info: unknown; parts: unknown[] }[],
    },
  }
}

const context = (abort = new AbortController().signal): ToolContext =>
  ({
    sessionID: ROOT,
    messageID: "msg",
    agent: "build",
    directory: "/work",
    worktree: "/work",
    abort,
    metadata: () => {},
    ask: async () => {},
  }) as unknown as ToolContext

async function start(): Promise<ServerParts> {
  return createSubagentsServer({ source: "test" })(host(), {})
}

const call = async (
  parts: ServerParts,
  name: string,
  args: Record<string, unknown> = {},
  ctx = context(),
) => {
  const def = parts.tools?.[name] as ToolDefinition
  const result = await def.execute(args as never, ctx)
  return typeof result === "string" ? result : result.output
}

/** What OpenCode 1 sent after it restarted, as the main agent continued the plan subagent. */
function continuedLive(parts: ServerParts) {
  const at = T1
  const events = [
    /** Touched, so OpenCode says what it is — but not what it did before. */
    { type: "session.updated", properties: { info: store[PLAN]?.info } },
    { type: "message.updated", properties: { info: { id: "p3", sessionID: PLAN, role: "user" } } },
    {
      type: "message.part.updated",
      properties: {
        part: {
          id: "p3p",
          sessionID: PLAN,
          messageID: "p3",
          type: "text",
          text: "Explore the repository and list every file.",
        },
      },
    },
    { type: "session.status", properties: { sessionID: PLAN, status: { type: "busy" } } },
    {
      type: "message.part.updated",
      properties: {
        part: {
          id: "t1",
          sessionID: PLAN,
          messageID: "p4",
          type: "tool",
          tool: "glob",
          callID: "c1",
          state: {
            status: "completed",
            input: { pattern: "**/*" },
            output: "a\nb",
            time: { start: at, end: at },
          },
        },
      },
    },
    {
      type: "session.error",
      properties: { sessionID: PLAN, error: ABORTED },
    },
    { type: "session.idle", properties: { sessionID: PLAN } },
  ]
  for (const event of events) parts.event?.(event)
}

describe("the guidance names only the options the tool has (load test #1)", () => {
  test("OpenCode 1 offers background only with its flag, or the umbrella experimental one", () => {
    expect(backgroundOffered(1, {})).toBe(false)
    expect(backgroundOffered(1, { OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS: "true" })).toBe(true)
    expect(backgroundOffered(1, { OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS: "1" })).toBe(true)
    expect(backgroundOffered(1, { OPENCODE_EXPERIMENTAL: "true" })).toBe(true)
    expect(
      backgroundOffered(1, {
        OPENCODE_EXPERIMENTAL: "true",
        OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS: "false",
      }),
    ).toBe(false)
    expect(backgroundOffered(2, {})).toBe(true)
  })

  test("without it, never pass background — run several in one message instead", () => {
    const text = subagentsGuidance({ version: 1, background: false })
    expect(text).toContain("never pass background")
    expect(text).toContain("in the same message")
    expect(text).not.toContain("background: true")
    expect(text).toContain("task_id")
  })

  test("with it, background is a boolean, and subagents_wait is the way to block", () => {
    const text = subagentsGuidance({ version: 2, background: true })
    expect(text).toContain("background: true, a boolean")
    expect(text).toContain("subagents_wait")
    expect(text).toContain("sessionID")
  })
})

describe("a subagent continued after OpenCode restarted (load test #2)", () => {
  test("lists its own task, agent and title — not the newest prompt sent to it", async () => {
    const parts = await start()
    continuedLive(parts)
    const text = await call(parts, "subagents_list")
    const plan = text.slice(text.indexOf(`- ${PLAN}`))
    /** Its last round's time, not the day between its rounds — and that it goes back further. */
    expect(plan).toContain(`- ${PLAN} · general · "Write a long plan" · stopped after 4m00s (round 2)`)
    expect(plan).toMatch(/first started \d{4}-\d\d-\d\d \d\d:\d\d/)
    expect(plan).not.toContain("24h")
    expect(plan).toContain("Task: Write a long plan into PLAN.md.")
    expect(plan).toContain("2 rounds")
  })

  test("one read from the store has its agent, and its title without OpenCode's suffix", async () => {
    const parts = await start()
    const text = await call(parts, "subagents_list")
    expect(text).toContain(`- ${FLAKY} · general · "Flaky shell starter" · done in 2m00s`)
    expect(text).not.toContain("(@general subagent)")
  })

  test("times say when, by the clock, beside how long ago", async () => {
    const parts = await start()
    const text = await call(parts, "subagents_list")
    expect(text).toMatch(/now: \d{4}-\d\d-\d\d \d\d:\d\d/)
    expect(text).toMatch(/done in \S+, \S+ ago \((\d{4}-\d\d-\d\d )?\d\d:\d\d\)/)
  })
})

describe("subagents_read (load test #3)", () => {
  test("a cancelled run: how far it got, how long it worked, and that it can be continued", async () => {
    const parts = await start()
    continuedLive(parts)
    const text = await call(parts, "subagents_read", { id: PLAN })
    expect(text).toContain("cancelled")
    expect(text).toContain("State: stopped after 4m00s (round 2)")
    expect(text).toContain("first started")
    expect(text).toContain("Task:\nWrite a long plan into PLAN.md.")
    expect(text).toContain("told: Explore the repository")
    expect(text).toContain('It can be continued — call the task tool with its id as task_id "ses_plan"')
  })

  test("a finished one: its whole answer", async () => {
    const parts = await start()
    const text = await call(parts, "subagents_read", { id: FLAKY })
    expect(text).toContain("Final answer:\nStarted sh_ch6u4lz4.")
    expect(text).not.toContain("can be continued")
  })

  test("an unknown id says which ids there are", async () => {
    const parts = await start()
    await expect(call(parts, "subagents_read", { id: "ses_nope" })).rejects.toThrow(/ses_flaky/)
  })

  test("a long run pages with a cursor", async () => {
    const parts = await start()
    await call(parts, "subagents_list")
    for (let i = 0; i < 60; i++)
      parts.event?.({
        type: "message.part.updated",
        properties: {
          part: {
            id: `x${i}`,
            sessionID: FLAKY,
            messageID: "m",
            type: "tool",
            tool: "read",
            callID: `call${i}`,
            state: { status: "completed", input: { filePath: `/work/src/file-${i}-${"x".repeat(150)}.ts` } },
          },
        },
      })
    const first = await call(parts, "subagents_read", { id: FLAKY })
    const more = /More: subagents_read id=ses_flaky after=(\d+)/.exec(first)
    expect(more).not.toBeNull()
    const next = await call(parts, "subagents_read", { id: FLAKY, after: Number(more?.[1]) })
    expect(next).not.toContain("Task:")
    expect(next).toContain(`${Number(more?.[1]) + 1}. `)
  })
})

describe("subagents_wait (load test #4)", () => {
  const running = (parts: ServerParts, id: string) => {
    parts.event?.({
      type: "session.created",
      properties: {
        info: { id, parentID: ROOT, agent: "general", title: "Audit", time: { created: Date.now() } },
      },
    })
    parts.event?.({ type: "session.status", properties: { sessionID: id, status: { type: "busy" } } })
    parts.event?.({
      type: "message.updated",
      properties: { info: { id: `${id}u`, sessionID: id, role: "user" } },
    })
    parts.event?.({
      type: "message.part.updated",
      properties: {
        part: { id: `${id}up`, sessionID: id, messageID: `${id}u`, type: "text", text: "Audit it" },
      },
    })
  }

  test("returns when the subagent finishes, with its answer", async () => {
    const parts = await start()
    running(parts, "ses_bg")
    const waiting = call(parts, "subagents_wait", { ids: ["ses_bg"] })
    setTimeout(() => {
      parts.event?.({
        type: "message.updated",
        properties: { info: { id: "a", sessionID: "ses_bg", role: "assistant" } },
      })
      parts.event?.({
        type: "message.part.updated",
        properties: {
          part: {
            id: "ap",
            sessionID: "ses_bg",
            messageID: "a",
            type: "text",
            text: "All clear.",
            time: { end: 1 },
          },
        },
      })
      parts.event?.({ type: "session.idle", properties: { sessionID: "ses_bg" } })
    }, 20)
    const text = await waiting
    expect(text).toContain('- ses_bg · "Audit" · done in')
    expect(text).toContain("Answer: All clear.")
  })

  test("gives up at its timeout, saying which are still working", async () => {
    const parts = await start()
    running(parts, "ses_slow")
    const text = await call(parts, "subagents_wait", { ids: ["ses_slow"], timeoutSeconds: 0.05 })
    expect(text).toContain("Timed out")
    expect(text).toContain("running")
  })

  test("with nothing working, says so at once", async () => {
    const parts = await start()
    const text = await call(parts, "subagents_wait", {})
    expect(text).toContain("nothing to wait on")
  })

  test("a cancelled call ends the wait", async () => {
    const parts = await start()
    running(parts, "ses_x")
    const abort = new AbortController()
    const waiting = call(parts, "subagents_wait", { ids: ["ses_x"] }, context(abort.signal))
    abort.abort()
    expect(await waiting).toContain("Wait cancelled")
  })
})

describe("OpenCode 2 after a restart: subagents it has no list of", () => {
  const OLD = "ses_old"
  /** OpenCode 2's agent side: no children, no status; a session and its messages by id. */
  const v2Host = (rootCreated: number): ServerHost => ({
    version: 2,
    directory: "/work",
    scope: {},
    log: silentLog,
    readFile: async () => undefined,
    session: {
      get: async (id) =>
        (id === ROOT
          ? { title: "Main", time: { created: rootCreated } }
          : id === OLD
            ? { parentID: ROOT, title: "Audit the logs", agent: "explore" }
            : undefined) as { parentID?: string },
      context: async (id) =>
        id === OLD
          ? [
              { id: "m1", type: "user", text: "Audit the logs.", time: { created: T0 } },
              {
                id: "m2",
                type: "assistant",
                time: { created: T0 + 1000, completed: T0 + 60_000 },
                content: [{ type: "text", text: "Nothing alarming.", time: { created: T0 + 59_000 } }],
              },
            ]
          : [],
      notify: async () => {},
    },
  })
  const startV2 = (rootCreated: number) => createSubagentsServer({ source: "test" })(v2Host(rootCreated), {})

  test("the list says older ones appear only once they do something, and that their ids still work", async () => {
    const text = await call(await startV2(T0 - DAY), "subagents_list")
    expect(text).toContain("This conversation has no subagents yet.")
    expect(text).toContain("appear here only once they do something")
    expect(text).toContain("by its id")
    const waited = await call(await startV2(T0 - DAY), "subagents_wait")
    expect(waited).toContain("appear here only once they do something")
  })

  test("a conversation begun since OpenCode started is not told so", async () => {
    const text = await call(await startV2(Date.now() + DAY), "subagents_list")
    expect(text).toBe("This conversation has no subagents yet.")
  })

  test("one from before is read by its id all the same", async () => {
    const text = await call(await startV2(T0 - DAY), "subagents_read", { id: OLD })
    expect(text).toContain('<subagent id="ses_old" agent="explore" title="Audit the logs">')
    expect(text).toContain("Final answer:\nNothing alarming.")
  })
})
