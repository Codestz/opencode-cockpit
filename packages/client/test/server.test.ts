import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { tool } from "@opencode-ai/plugin"
import { silentLog } from "../src/log.ts"
import {
  addToV1Config,
  commandText,
  composeParts,
  dualServer,
  follow,
  partsToV1Hooks,
  readSkill,
  type ServerParts,
  serverFromV1,
  serverFromV2,
  type ToolCall,
  toolToV2,
  v1ToolText,
  v2ToolCall,
} from "../src/opencode/server.ts"

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

  test("skills are listed once, and a command name registered twice throws", () => {
    const command = { name: "same", description: "", prompt: "p" }
    expect(composeParts([{ skills: [{ dir: "/s" }] }, { skills: [{ dir: "/s" }] }]).skills).toEqual([
      { dir: "/s" },
    ])
    expect(() => composeParts([{ commands: [command] }, { commands: [command] }])).toThrow(
      'command "/same" is registered by more than one cockpit feature',
    )
  })
})

describe("skills and commands", () => {
  const command = { name: "cockpit-setup", description: "set up", prompt: "Use the cockpit-setup skill." }

  test("OpenCode 1: into its config, beneath what the user wrote, each folder once", async () => {
    const hooks = partsToV1Hooks({ skills: [{ dir: "/pkg/skills/a" }], commands: [command] })
    const config = {
      command: { other: { template: "x" } },
      skills: { paths: ["/mine", "/pkg/skills/a"] },
    } as Record<string, unknown>
    await (hooks as { config?: (config: unknown) => Promise<void> }).config?.(config)
    expect(config).toEqual({
      command: {
        other: { template: "x" },
        "cockpit-setup": { template: "Use the cockpit-setup skill.", description: "set up" },
      },
      skills: { paths: ["/mine", "/pkg/skills/a"] },
    })
    const mine = { command: { "cockpit-setup": { template: "my own" } } } as Record<string, unknown>
    addToV1Config(mine as never, { commands: [command], skills: [{ dir: "/b" }] })
    expect(mine).toEqual({
      command: { "cockpit-setup": { template: "my own", description: "set up" } },
      skills: { paths: ["/b"] },
    })
  })

  test("a skill's folder read for OpenCode 2: frontmatter names it, the body is the content", () => {
    const dir = mkdtempSync(join(tmpdir(), "ck-skill-"))
    writeFileSync(
      join(dir, "SKILL.md"),
      '---\nname: probe\ndescription: "Does a thing: well"\n---\n\n# Probe\nbody\n',
    )
    expect(readSkill({ dir })).toEqual({
      id: "probe",
      name: "probe",
      description: "Does a thing: well",
      path: join(dir, "SKILL.md"),
      content: "\n# Probe\nbody\n",
    })
    expect(readSkill({ dir: join(dir, "missing") })).toBeUndefined()
  })

  test("a command's line, then whatever was typed after its name", () => {
    expect(commandText(command, { sessionID: "s", prompt: { text: "" } })).toBe(command.prompt)
    expect(commandText(command, { sessionID: "s", prompt: { text: " hide shells " } })).toBe(
      `${command.prompt}\n\nhide shells`,
    )
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
function fakeV2(events: { type: string; data?: { sessionID?: string } }[] = [], directory = "/work/project") {
  const added: string[] = []
  const hooks: string[] = []
  const skills: { id: string; path: string }[] = []
  const commands: { name: string; execute(input: unknown): Promise<void> }[] = []
  const prompts: unknown[] = []
  let context: ((event: { sessionID: string; system: unknown[] }) => unknown) | undefined
  const ctx = {
    options: {},
    location: { directory },
    tool: {
      transform: async (edit: (editor: { add: (tool: { name: string }) => void }) => void) => {
        edit({ add: (tool) => added.push(tool.name) })
      },
    },
    skill: {
      transform: async (edit: (editor: unknown) => void) => {
        edit({
          get: (id: string) => skills.find((skill) => skill.id === id),
          add: (skill: { id: string; path: string }) => skills.push(skill),
        })
      },
    },
    command: {
      transform: async (edit: (editor: unknown) => void) => {
        edit({ add: (command: (typeof commands)[number]) => commands.push(command) })
      },
    },
    session: {
      get: async () => undefined,
      synthetic: async () => undefined,
      prompt: async (input: unknown) => void prompts.push(input),
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
  return { ctx, added, hooks, skills, commands, prompts, system: () => context }
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
    expect(fake.added).toContain("echo")
    expect(fake.hooks).toEqual(["context"])
    const event = { sessionID: "ses_1", system: [] as unknown[] }
    await fake.system()?.(event)
    expect(event.system).toEqual([{ type: "text", text: "guidance for ses_1" }])
    await Bun.sleep(0)
    expect(deleted).toEqual(["ses_9"])
    await cleanup?.()
    expect(disposed).toBe(true)
  })

  test("v2's setup adds the setup tool, skill and command once, and a command prompts queued", async () => {
    const one = fakeV2([], "/work/setup-v2")
    const two = fakeV2([], "/work/setup-v2")
    const entry = dualServer("cockpit.test", async () => ({}))
    const cleanup = await entry.setup(one.ctx as never)
    await entry.setup(two.ctx as never)
    expect(one.added).toEqual(["cockpit_settings", "cockpit_conventions"])
    expect(one.skills.map((skill) => skill.id)).toEqual(["cockpit-setup"])
    expect(one.skills[0]?.path).toEndWith("skills/cockpit-setup/SKILL.md")
    expect(one.commands.map((command) => command.name)).toEqual(["cockpit-setup"])
    expect(two.added).toEqual([])
    /** v2 hands a command `steer` even when idle; it is sent queued, which starts at once when idle. */
    await one.commands[0]?.execute({ sessionID: "ses_1", prompt: { text: "" }, delivery: "steer" })
    expect(one.prompts).toEqual([
      {
        sessionID: "ses_1",
        text: "Use the cockpit-setup skill to help me set up Cockpit.",
        delivery: "queue",
      },
    ])
    await cleanup?.()
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

describe("v2's event stream", () => {
  /** A stream that closed stayed closed: sessions deleted afterwards left their shells behind. */
  test("is opened again when it ends or fails, until the plugin stops", async () => {
    const stop = new AbortController()
    const seen: string[] = []
    let opened = 0
    const ctx = {
      event: {
        subscribe: async function* () {
          opened++
          if (opened === 1) {
            yield { type: "session.deleted", data: { sessionID: "ses_1" } }
            return
          }
          if (opened === 2) throw new Error("service restarted")
          yield { type: "session.deleted", data: { sessionID: "ses_3" } }
          stop.abort()
        },
      },
    }
    const waits: number[] = []
    await follow(
      ctx as never,
      stop.signal,
      silentLog,
      async (event) => void seen.push(event.data?.sessionID ?? ""),
      async (ms) => void waits.push(ms),
    )
    expect(seen).toEqual(["ses_1", "ses_3"])
    expect(opened).toBe(3)
    expect(waits).toEqual([1_000, 2_000])
  })
})

/**
 * Shell's notices go to the session that started a shell, and a subagent still at work has to get
 * them inside its turn: v1 answers "busy?" itself, v2 has to be told to steer.
 */
describe("messaging a session that may be busy", () => {
  test("v1 reads busy from the status map, and a session left out of it is idle", async () => {
    const client = {
      session: {
        status: async () => ({
          data: { ses_busy: { type: "busy" }, ses_retry: { type: "retry", attempt: 1 } },
        }),
      },
    }
    const host = serverFromV1({ client, directory: "/work" } as never)
    expect(await host.session.busy?.("ses_busy")).toBe(true)
    expect(await host.session.busy?.("ses_retry")).toBe(true)
    expect(await host.session.busy?.("ses_idle")).toBe(false)
  })

  test("v1 that cannot answer says so instead of guessing", async () => {
    const client = { session: { status: async () => Promise.reject(new Error("offline")) } }
    const host = serverFromV1({ client, directory: "/work" } as never)
    expect(await host.session.busy?.("ses_1")).toBeUndefined()
  })

  test("v2 steers when asked to, and leaves delivery to OpenCode otherwise", async () => {
    const sent: unknown[] = []
    const ctx = {
      location: { directory: "/work" },
      session: { synthetic: async (input: unknown) => void sent.push(input) },
    }
    const host = serverFromV2(ctx as never)
    expect(host.session.busy).toBeUndefined()
    await host.session.notify("ses_sub", "hi", { steer: true })
    await host.session.notify("ses_root", "hello")
    expect(sent).toEqual([
      { sessionID: "ses_sub", text: "hi", delivery: "steer" },
      { sessionID: "ses_root", text: "hello" },
    ])
  })
})

/**
 * A finished tool call, heard the same on both versions (docs/opencode/trail-server.md): v1's MCP
 * output sits in another field, and v2 fires twice for a Code Mode call — only the inner one counts.
 */
describe("toolAfter", () => {
  test("v1: a built-in's output, and an MCP tool's content, both arrive as text", async () => {
    const calls: ToolCall[] = []
    const hooks = partsToV1Hooks({ toolAfter: (call) => void calls.push(call) })
    const after = hooks["tool.execute.after"]
    const input = { tool: "bash", sessionID: "ses_1", callID: "call_1", args: { command: "gh pr create" } }
    await after?.(input, { title: "", output: "https://github.com/a/b/pull/33\n", metadata: {} })
    await after?.({ ...input, tool: "spike_open_pr", callID: "call_2", args: {} }, {
      content: [{ type: "text", text: "Created pull request: x/77" }, { type: "image" }],
    } as never)
    expect(calls).toEqual([
      {
        sessionID: "ses_1",
        tool: "bash",
        callID: "call_1",
        args: input.args,
        output: "https://github.com/a/b/pull/33\n",
      },
      {
        sessionID: "ses_1",
        tool: "spike_open_pr",
        callID: "call_2",
        args: {},
        output: "Created pull request: x/77",
      },
    ])
  })

  test("v1 text, whichever field it is in", () => {
    expect(v1ToolText({ output: "a" })).toBe("a")
    expect(
      v1ToolText({
        content: [
          { type: "text", text: "a" },
          { type: "text", text: "b" },
        ],
      }),
    ).toBe("a\nb")
    expect(v1ToolText(undefined)).toBe("")
  })

  test("v2: the inner call is delivered, Code Mode's outer `execute` and failures are not", () => {
    const inner = {
      tool: "spike_open_pr",
      sessionID: "ses_1",
      agent: "general",
      id: "call_9",
      input: { title: "x" },
      status: "completed",
      result: {
        output: "Created pull request: x/77",
        content: [{ type: "text", text: "Created pull request: x/77" }],
      },
    }
    expect(v2ToolCall(inner)).toEqual({
      sessionID: "ses_1",
      tool: "spike_open_pr",
      callID: "call_9",
      args: { title: "x" },
      output: "Created pull request: x/77",
      agent: "general",
    })
    expect(v2ToolCall({ ...inner, tool: "execute" })).toBeUndefined()
    expect(v2ToolCall({ ...inner, status: "error", error: "boom" })).toBeUndefined()
    /** `shell`'s `output` is an object; `content` carries its text. */
    const shell = {
      ...inner,
      tool: "shell",
      result: { output: { exit: 0 }, content: [{ type: "text", text: "ok" }] },
    }
    expect(v2ToolCall(shell)?.output).toBe("ok")
    expect(v2ToolCall({ ...inner, result: { output: "only output" } })?.output).toBe("only output")
  })

  test("v2's setup registers execute.after, and a feature's failure never reaches the call", async () => {
    const seen: string[] = []
    let run: ((event: unknown) => unknown) | undefined
    const fake = fakeV2()
    const ctx = {
      ...fake.ctx,
      tool: {
        ...fake.ctx.tool,
        hook: async (name: string, handler: (event: unknown) => unknown) => {
          seen.push(name)
          run = handler
        },
      },
    }
    const calls: string[] = []
    const entry = dualServer("cockpit.test", async () => ({
      toolAfter: (call) => {
        calls.push(call.tool)
        if (call.tool === "bad") throw new Error("listener broke")
      },
    }))
    await entry.setup(ctx as never)
    expect(seen).toEqual(["execute.after"])
    const event = (tool: string) => ({ tool, sessionID: "s", id: "c", result: { content: [] } })
    await run?.(event("spike_open_pr"))
    await run?.(event("execute"))
    await run?.(event("bad"))
    expect(calls).toEqual(["spike_open_pr", "bad"])
  })

  test("composed: every feature hears the call, even after one fails", async () => {
    const heard: string[] = []
    const parts = composeParts([
      {
        toolAfter: () => {
          heard.push("a")
          throw new Error("a broke")
        },
      },
      { toolAfter: () => void heard.push("b") },
    ])
    const call = { sessionID: "s", tool: "t", callID: "c", args: {}, output: "" }
    await expect(parts.toolAfter?.(call) ?? Promise.resolve()).rejects.toThrow("a broke")
    expect(heard).toEqual(["a", "b"])
  })
})
