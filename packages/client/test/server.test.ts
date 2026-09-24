import { describe, expect, test } from "bun:test"
import { tool } from "@opencode-ai/plugin"
import { composeParts, dualServer, partsToV1Hooks, type ServerParts, toolToV2 } from "../src/server.ts"

/**
 * The server half of running on both: one feature's tools and hooks, handed to v1 as hooks and to
 * v2 as registrations. What is checked is the translation — against fakes shaped like each version's
 * context — since a tool v2 never registered is an agent that silently cannot do the thing.
 */

const echo = tool({
  description: "Echo",
  args: { text: tool.schema.string(), loud: tool.schema.boolean().default(false) },
  execute: async (args, context) =>
    `${args.loud ? args.text.toUpperCase() : args.text} in ${context.directory}`,
})

describe("several features as one", () => {
  test("unions tools and runs shared hooks in feature order", async () => {
    const calls: string[] = []
    const a: ServerParts = {
      tools: { a_tool: echo },
      system: async () => ["a"],
      dispose: () => void calls.push("a:dispose"),
    }
    const b: ServerParts = {
      tools: { b_tool: echo },
      system: async () => ["b"],
      sessionDeleted: async (id) => void calls.push(`b:deleted ${id}`),
    }
    const parts = composeParts([a, b])
    expect(Object.keys(parts.tools ?? {})).toEqual(["a_tool", "b_tool"])
    expect(await parts.system?.("ses_1")).toEqual(["a", "b"])
    await parts.sessionDeleted?.("ses_1")
    await parts.dispose?.()
    expect(calls).toEqual(["b:deleted ses_1", "a:dispose"])
  })

  test("a tool name registered twice is a bug and throws", () => {
    expect(() => composeParts([{ tools: { same: echo } }, { tools: { same: echo } }])).toThrow(
      'tool "same" is registered by more than one cockpit feature',
    )
  })

  test("no features means no hooks", () => {
    expect(composeParts([])).toEqual({})
    expect(partsToV1Hooks(composeParts([{}]))).toEqual({})
  })
})

describe("on OpenCode 1", () => {
  test("system lines and deleted sessions arrive through v1's hooks", async () => {
    const deleted: string[] = []
    const hooks = partsToV1Hooks({
      system: async (sessionID) => [`for ${sessionID}`],
      sessionDeleted: async (id) => void deleted.push(id),
    })
    const output = { system: [] as string[] }
    await hooks["experimental.chat.system.transform"]?.({ sessionID: "ses_1" } as never, output as never)
    expect(output.system).toEqual(["for ses_1"])
    await hooks.event?.({
      event: { type: "session.deleted", properties: { info: { id: "ses_2" } } } as never,
    })
    await hooks.event?.({ event: { type: "session.idle", properties: {} } as never })
    expect(deleted).toEqual(["ses_2"])
  })
})

describe("a v1 tool, as v2 registers it", () => {
  const v2 = toolToV2("echo", echo, "/work/project")
  const context = {
    sessionID: "ses_1",
    agent: "build",
    messageID: "msg_1",
    signal: new AbortController().signal,
    progress: async () => {},
  }

  test("is described by JSON Schema, which is what v2 shows the model", () => {
    expect(v2.input).toMatchObject({
      type: "object",
      properties: { text: { type: "string" }, loud: { type: "boolean", default: false } },
      required: ["text"],
    })
  })

  test("parses its arguments here, so defaults apply as they do on v1", async () => {
    expect(await v2.execute({ text: "hi" }, context)).toEqual({ content: "hi in /work/project" })
    expect(await v2.execute({ text: "hi", loud: true }, context)).toEqual({ content: "HI in /work/project" })
  })

  test("refuses arguments v1 would have refused", async () => {
    await expect(v2.execute({ loud: true }, context)).rejects.toThrow()
  })
})

/** Enough of a v2 server context to watch what gets registered. */
function fakeV2(events: { type: string; data?: { sessionID?: string } }[] = []) {
  const added: string[] = []
  const hooks: string[] = []
  let context: ((event: { sessionID: string; system: unknown[] }) => unknown) | undefined
  const ctx = {
    options: {},
    location: { directory: "/work/project" },
    tool: {
      transform: async (edit: (editor: { add: (tool: { name: string }) => void }) => void) => {
        edit({ add: (tool) => added.push(tool.name) })
      },
    },
    session: {
      get: async () => undefined,
      synthetic: async () => undefined,
      hook: async (name: string, run: typeof context) => {
        hooks.push(name)
        context = run
      },
    },
    event: {
      subscribe: async function* () {
        for (const event of events) yield event
      },
    },
  }
  return { ctx, added, hooks, system: () => context }
}

describe("one entry for both", () => {
  test("v1's preview call to setup registers nothing", async () => {
    let started = false
    const entry = dualServer("cockpit.test", async () => {
      started = true
      return {}
    })
    /** What v1 1.18.32 passes: no `tool`, no `location`. */
    await entry.setup({ options: {} } as never)
    expect(started).toBe(false)
  })

  test("v2's setup registers the tools, the context hook, and follows deleted sessions", async () => {
    const deleted: string[] = []
    let disposed = false
    const fake = fakeV2([{ type: "session.idle" }, { type: "session.deleted", data: { sessionID: "ses_9" } }])
    const entry = dualServer("cockpit.test", async (host) => {
      expect(host.version).toBe(2)
      expect(host.directory).toBe("/work/project")
      return {
        tools: { echo },
        system: async (sessionID) => [`guidance for ${sessionID}`],
        sessionDeleted: async (id) => void deleted.push(id),
        dispose: () => {
          disposed = true
        },
      }
    })
    const cleanup = await entry.setup(fake.ctx as never)
    expect(fake.added).toEqual(["echo"])
    expect(fake.hooks).toEqual(["context"])
    const event = { sessionID: "ses_1", system: [] as unknown[] }
    await fake.system()?.(event)
    expect(event.system).toEqual([{ type: "text", text: "guidance for ses_1" }])
    await Bun.sleep(0)
    expect(deleted).toEqual(["ses_9"])
    await cleanup?.()
    expect(disposed).toBe(true)
  })

  test("two copies in one OpenCode 2 share a claim scope, so a feature loads once", async () => {
    const scopes: object[] = []
    const entry = dualServer("cockpit.test", async (host) => {
      scopes.push(host.scope)
      return {}
    })
    await entry.setup(fakeV2().ctx as never)
    await entry.setup(fakeV2().ctx as never)
    expect(scopes[0]).toBe(scopes[1])
  })
})
