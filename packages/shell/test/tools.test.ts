import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin"
import { startDaemon } from "../../client/test/helpers.ts"
import { formatLines } from "../src/tools/format.ts"
import { createTools } from "../src/tools/index.ts"
import { encodeKey } from "../src/tools/keys.ts"

let env: Awaited<ReturnType<typeof startDaemon>>
let tools: ReturnType<typeof createTools>
const asked: string[] = []
const quiet = new Set<string>()

const ctx = (): ToolContext => ({
  sessionID: "ses_1",
  messageID: "msg_1",
  agent: "build",
  directory: "/tmp",
  worktree: "/tmp",
  abort: new AbortController().signal,
  metadata() {},
  async ask(input) {
    asked.push(...input.patterns)
  },
})

const run = (name: string, args: Record<string, unknown>) =>
  // biome-ignore lint/suspicious/noExplicitAny: test harness drives tools with raw args
  (tools[name] as any).execute((tools[name] as any).args ? parse(name, args) : args, ctx()) as Promise<string>

function parse(name: string, args: Record<string, unknown>) {
  // biome-ignore lint/suspicious/noExplicitAny: zod shape from the tool definition
  const { z } = require("zod") as any
  return z.object((tools[name] as { args: object }).args).parse(args)
}

const idOf = (out: string) => (/sh_[a-z2-7]{8}/.exec(out) as RegExpExecArray)[0]

beforeAll(async () => {
  env = await startDaemon()
  tools = createTools({
    client: env.client("tools"),
    instance: "inst",
    quiet,
    env: () => ({ PATH: process.env.PATH ?? "" }),
    shellCommand: (command) => ({ command: "/bin/bash", args: ["--noprofile", "--norc", "-c", command] }),
  })
})
afterAll(async () => {
  await env.dispose()
})

describe("agent tools", () => {
  test("shell_start asks permission, waits for readiness and shows output", async () => {
    const out = await run("shell_start", {
      command: "echo booting; sleep 0.3; echo 'listening on :4000'; sleep 30",
      description: "fake dev server",
      waitFor: { pattern: "listening on :(\\d+)", timeoutSeconds: 5 },
    })
    expect(asked).toContain("echo booting; sleep 0.3; echo 'listening on :4000'; sleep 30")
    expect(out).toContain("condition met: pattern matched")
    expect(out).toContain("listening on :4000")
    expect(out).toMatch(/cursor: \d+/)
  })

  test("shell_start without waitFor returns initial output quickly", async () => {
    const t0 = Date.now()
    const out = await run("shell_start", {
      command: "echo hello-world; sleep 30",
      description: "quick peek test",
    })
    expect(Date.now() - t0).toBeLessThan(2500)
    expect(out).toContain("hello-world")
  })

  test("shell_send drives an interactive prompt and returns its reply", async () => {
    const started = await run("shell_start", {
      command: "while read -p 'calc> ' line; do echo \"= $((line))\"; done",
      description: "bash calculator",
      waitFor: { pattern: "calc>", timeoutSeconds: 5 },
    })
    const id = idOf(started)
    const out = await run("shell_send", { id, text: "6*7", submit: true })
    expect(out).toContain("= 42")
    await run("shell_send", { id, keys: ["ctrl+d"], waitSeconds: 0 })
    expect(await run("shell_wait", { id, exit: true, timeoutSeconds: 10 })).toContain("process ended: exited")
  })

  test("shell_read follows with a cursor and greps", async () => {
    const started = await run("shell_start", {
      command: 'for i in $(seq 1 30); do echo "item $i"; done; echo ERROR boom',
      description: "numbered output",
      waitFor: { exit: true, timeoutSeconds: 5 },
    })
    const id = idOf(started)
    const errors = await run("shell_read", { id, grep: "error", ignoreCase: true, after: 0 })
    expect(errors).toContain("ERROR boom")
    expect(errors).not.toContain("item 3")
    const tail = await run("shell_read", { id, tail: 2 })
    expect(tail).toContain("item 30")
    const cursor = Number((/cursor: (\d+)/.exec(tail) as RegExpExecArray)[1])
    expect(await run("shell_read", { id, after: cursor })).toContain("(no new output)")
  })

  test("shell_wait reports timeouts and exits clearly", async () => {
    const id = idOf(await run("shell_start", { command: "sleep 0.5; exit 2", description: "failing job" }))
    const out = await run("shell_wait", { id, pattern: "never", timeoutSeconds: 5 })
    expect(out).toContain("process ended: exited with code 2")
  })

  test("shell_stop silences the exit notification and shell_list shows state", async () => {
    const id = idOf(await run("shell_start", { command: "sleep 60", description: "sleeper" }))
    const out = await run("shell_stop", { id })
    expect(out).toContain("killed")
    expect(quiet.has(id)).toBe(true)
    const list = await run("shell_list", {})
    expect(list).toContain(id)
    expect(list).toContain("sleeper")
  })

  test("shell_start reuses a finished shell with the same command in the same session", async () => {
    const first = await run("shell_start", {
      command: "echo tests; exit 1",
      description: "unit tests",
      waitFor: { exit: true },
    })
    const again = await run("shell_start", {
      command: "echo tests; exit 1",
      description: "unit tests",
      waitFor: { exit: true },
    })
    expect(idOf(again)).toBe(idOf(first))
    expect(again).toContain("(run 2)")
  })

  test("shell_restart keeps the id", async () => {
    const id = idOf(await run("shell_start", { command: "echo v1; sleep 30", description: "restartable" }))
    const out = await run("shell_restart", { id })
    expect(out).toContain(`Restarted ${id} (run 2)`)
  })
})

describe("format and keys", () => {
  test("collapses repeated lines", () => {
    const out = formatLines([
      { n: 1, text: "a" },
      { n: 2, text: "tick" },
      { n: 3, text: "tick" },
      { n: 4, text: "tick" },
      { n: 5, text: "b" },
    ])
    expect(out).toBe("1| a\n2| tick  (×3, lines 2-4)\n5| b")
  })

  test("encodes named keys", () => {
    expect(encodeKey("ctrl+c")).toBe("\x03")
    expect(encodeKey("Enter")).toBe("\r")
    expect(encodeKey("up")).toBe("\x1b[A")
    expect(() => encodeKey("hyper+x")).toThrow("unknown key")
  })
})

describe("OpenCode passes raw args (no zod defaults, nulls for omitted fields)", () => {
  const raw = (name: string, args: Record<string, unknown>) =>
    // biome-ignore lint/suspicious/noExplicitAny: raw invocation mirrors OpenCode
    (tools[name] as any).execute(args, ctx()) as Promise<string>

  test("shell_start with waitFor lacking timeoutSeconds, notify left on", async () => {
    const out = await raw("shell_start", {
      command: "sleep 0.2; echo up; sleep 30",
      description: "raw args start",
      waitFor: { pattern: "up", timeoutSeconds: null },
      notifyOnExit: undefined,
    })
    expect(out).toContain("condition met")
    expect(quiet.has(idOf(out))).toBe(false)
  })

  test("shell_read/send/wait/list/stop tolerate missing optionals", async () => {
    const id = idOf(await raw("shell_start", { command: "cat", description: "raw echo" }))
    expect(await raw("shell_send", { id, text: "ping", keys: null, submit: true })).toContain("ping")
    expect(await raw("shell_read", { id, view: undefined, after: null, grep: null })).toContain("ping")
    expect(await raw("shell_wait", { id, idleSeconds: 0.2, pattern: null })).toContain("condition met")
    expect(await raw("shell_list", {})).toContain(id)
    expect(await raw("shell_stop", { id })).toContain("killed")
  })
})
