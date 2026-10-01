/**
 * The interface half against a host made of an object: events in, replies out, the ledger on disk.
 * It proves the wiring — that a request trusted by the file is answered through the right call, that
 * our own reply's echo is not counted, that a specific `ask` is left alone — on both OpenCodes' shapes.
 * What only a real OpenCode can show (the prompt, the sidebar on screen) is not claimed here.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Host } from "@opencode-cockpit/client/host"
import { silentLog } from "@opencode-cockpit/client/log"
import { trustPaths } from "../src/core/paths.ts"
import { createTrustTui } from "../src/tui/index.tsx"

const DIRECTORY = "/work/app"
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

interface Fake {
  host: Host
  emit: (event: unknown) => void
  replies: unknown[]
  disposers: (() => void)[]
  ledger: () => { type: string }[]
}

function fakeV1(permission: unknown = { bash: "ask" }): Fake {
  const handlers = new Map<string, ((event: unknown) => void)[]>()
  const replies: unknown[] = []
  const disposers: (() => void)[] = []
  const pending = new Map<string, unknown>()
  const emit = (event: unknown) => {
    const { type, properties } = event as { type: string; properties: { id?: string; requestID?: string } }
    if (type === "permission.asked" && properties.id) pending.set(properties.id, properties)
    if (type === "permission.replied" && properties.requestID) pending.delete(properties.requestID)
    for (const handler of handlers.get(type) ?? []) handler(event)
  }
  const v1 = {
    event: {
      on: (type: string, handler: (event: unknown) => void) => {
        handlers.set(type, [...(handlers.get(type) ?? []), handler])
        return () => {}
      },
    },
    client: {
      permission: {
        reply: async (input: { requestID: string; reply: string }) => {
          replies.push(input)
          /** OpenCode echoes the reply as an event, a few milliseconds later. */
          setTimeout(
            () =>
              emit({
                type: "permission.replied",
                properties: { sessionID: "ses_1", requestID: input.requestID, reply: input.reply },
              }),
            2,
          )
          return { data: true }
        },
        list: async () => ({ data: [...pending.values()] }),
      },
      config: { get: async () => ({ data: { permission } }) },
    },
    state: { part: () => [], session: { messages: () => [] } },
  }
  const host = {
    version: 1,
    renderer: { width: 120, height: 40, requestRender: () => {} },
    theme: { current: {} },
    state: { path: { directory: DIRECTORY, worktree: DIRECTORY }, vcs: undefined },
    route: { current: { name: "home" } },
    kv: { get: (_: string, fallback: unknown) => fallback, set: () => {} },
    ui: {
      toast: () => {},
      dialog: { replace: () => {}, clear: () => {}, setSize: () => {}, depth: 0 },
    },
    keymap: {
      registerLayer: () => () => {},
      useLayer: () => {},
      intercept: () => () => {},
      shortcut: () => "",
    },
    slots: { register: () => {} },
    lifecycle: { onDispose: (fn: () => void) => disposers.push(fn) },
    log: silentLog,
    promptSession: async () => {},
    v1,
  } as unknown as Host
  const ledger = () => {
    try {
      return readFileSync(trustPaths(DIRECTORY).events, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    } catch {
      return []
    }
  }
  return { host, emit, replies, disposers, ledger }
}

let current: Fake | undefined
const saved = { COCKPIT_HOME: process.env.COCKPIT_HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME }
afterEach(() => {
  for (const dispose of current?.disposers ?? []) dispose()
  current = undefined
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

async function start(permission?: unknown): Promise<Fake> {
  process.env.COCKPIT_HOME = mkdtempSync(join(tmpdir(), "trust-tui-"))
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "trust-tui-config-"))
  const fake = fakeV1(permission)
  current = fake
  await createTrustTui({ source: `test-${Math.random()}` })(fake.host, {})
  await wait(30)
  return fake
}

let n = 0
/** The agent runs `line`: its call, then its request. A person answers after `after` ms, or nobody does. */
async function run(fake: Fake, line: string, after?: number) {
  n++
  const call = `call_${n}`
  const id = `per_${n}`
  fake.emit({
    type: "message.part.updated",
    properties: {
      part: {
        type: "tool",
        callID: call,
        sessionID: "ses_1",
        messageID: "msg_1",
        state: { status: "running", input: { command: line } },
      },
    },
  })
  fake.emit({
    type: "permission.asked",
    properties: {
      id,
      sessionID: "ses_1",
      permission: "bash",
      patterns: [line],
      always: [],
      tool: { messageID: "msg_1", callID: call },
    },
  })
  await wait(10)
  if (
    after !== undefined &&
    !fake.replies.some((reply) => (reply as { requestID: string }).requestID === id)
  ) {
    await wait(after)
    fake.emit({
      type: "permission.replied",
      properties: { sessionID: "ses_1", requestID: id, reply: "once" },
    })
  }
  await wait(30)
  return id
}

describe("Trust in a host", () => {
  test('approved three times by a person, the fourth is answered with "once"', async () => {
    const fake = await start()
    fake.emit({ type: "message.updated", properties: { info: { sessionID: "ses_1", agent: "build" } } })
    for (let i = 0; i < 3; i++) await run(fake, "git status", 320)
    expect(fake.replies).toEqual([])
    const id = await run(fake, "git status")
    expect(fake.replies).toEqual([{ requestID: id, reply: "once" }])
    const types = fake.ledger().map((event) => event.type)
    expect(types.filter((type) => type === "approved")).toHaveLength(3)
    expect(types.filter((type) => type === "auto")).toHaveLength(1)
    /** The echo of our own reply is not a fourth approval. */
    expect(types.filter((type) => type === "approved")).toHaveLength(3)
  })

  test("a specific ask is never answered", async () => {
    const fake = await start({ bash: { "*": "ask", "git push *": "ask" } })
    for (let i = 0; i < 4; i++) await run(fake, "git push", 320)
    expect(fake.replies).toEqual([])
  })

  test("trust earned in an earlier session answers from the file", async () => {
    const first = await start()
    for (let i = 0; i < 3; i++) await run(first, "bun test", 320)
    for (const dispose of first.disposers) dispose()
    const home = process.env.COCKPIT_HOME
    const again = fakeV1()
    current = again
    process.env.COCKPIT_HOME = home
    await createTrustTui({ source: `test-${Math.random()}` })(again.host, {})
    await wait(30)
    const id = await run(again, "bun test")
    expect(again.replies).toEqual([{ requestID: id, reply: "once" }])
  })
})
