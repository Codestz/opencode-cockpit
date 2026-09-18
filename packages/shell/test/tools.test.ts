import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import type { ToolContext } from "@opencode-ai/plugin"
import { startDaemon } from "../../client/test/helpers.ts"
import { formatLines } from "../src/tools/format.ts"
import { createTools } from "../src/tools/index.ts"
import { encodeKey } from "../src/tools/keys.ts"

let env: Awaited<ReturnType<typeof startDaemon>>
let tools: ReturnType<typeof createTools>
const asked: string[] = []
const quiet = new Set<string>()

const ctx = (sessionID = "ses_1", directory = "/tmp"): ToolContext => ({
  sessionID,
  messageID: "msg_1",
  agent: "build",
  directory,
  worktree: directory,
  abort: new AbortController().signal,
  metadata() {},
  async ask(input) {
    asked.push(...input.patterns)
  },
})

type RawTool = { args?: object; execute(args: unknown, context: ToolContext): Promise<string> }

/** Drives a tool the way OpenCode does: parse args with the tool's schema, then execute. */
const run = (name: string, args: Record<string, unknown>, context = ctx()) => {
  const tool = tools[name] as unknown as RawTool
  return tool.execute(tool.args ? parse(name, args) : args, context)
}

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
    sessionTitle: async (id) => (id === "ses_2" ? "Refactor auth" : undefined),
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

describe("watching shell health", () => {
  test("shell_start can watch, and changes are visible to shell_list", async () => {
    const out = await run("shell_start", {
      command:
        "echo 'Found 0 errors. Watching for file changes.'; sleep 0.4; echo \"src/a.ts(1,1): error TS2339: nope\"; echo 'Found 1 error. Watching for file changes.'; sleep 30",
      description: "type checker",
      watch: "tsc",
    })
    expect(out).toContain("watching health (tsc)")
    const id = idOf(out)
    await Bun.sleep(900)
    const list = await run("shell_list", { query: "type checker" })
    expect(list).toContain("watch: tsc · fail")
    expect(list).toContain("TS2339")
    expect(await run("shell_watch", { id, off: true })).toContain("stopped watching")
    await run("shell_stop", { id })
  })

  test("shell_watch takes a custom rule and explains an unmatched command", async () => {
    const id = idOf(
      await run("shell_start", { command: "echo booting; sleep 30", description: "custom watch" }),
    )
    expect(await run("shell_watch", { id, rule: { fail: "PANIC", ok: "READY", idleSeconds: 1 } })).toContain(
      "watching",
    )
    const noPreset = idOf(
      await run("shell_start", {
        command: "echo nothing-recognisable; sleep 30",
        description: "no preset here",
      }),
    )
    const error = await run("shell_watch", { id: noPreset }).catch((e: Error) => e.message)
    expect(error).toContain("no watch preset matches")
    for (const shell of [id, noPreset]) await run("shell_stop", { id: shell })
  })
})

describe("finding shells across sessions", () => {
  // A project of its own, so names from other tests cannot collide.
  const project = mkdtempSync("/tmp/ck-names-")
  const me = () => ctx("ses_1", project)
  const other = () => ctx("ses_2", project)
  afterAll(() => rmSync(project, { recursive: true, force: true }))

  test("a shell started in another session is found by name and labelled with that session", async () => {
    await run(
      "shell_start",
      { command: "echo polling jobs; sleep 30", description: "DB Monitoring" },
      other(),
    )
    await run("shell_start", { command: "echo hi; sleep 30", description: "Web dev server" }, me())

    const read = await run("shell_read", { name: "db monitoring" }, me())
    expect(read).toContain("polling jobs")

    const list = await run("shell_list", {}, me())
    expect(list).toContain('"DB Monitoring"')
    expect(list).toContain('session "Refactor auth"')
    expect(list).toContain("this session")
  })

  test("shell_list filters by text, status and session", async () => {
    const mine = await run("shell_list", { session: "this" }, me())
    expect(mine).toContain("Web dev server")
    expect(mine).not.toContain("DB Monitoring")
    expect(mine).toContain("1 more shell hidden by filters")

    expect(await run("shell_list", { query: "polling" }, me())).toContain("DB Monitoring")
    expect(await run("shell_list", { status: "failed" }, me())).toContain("No shells match those filters")
  })

  test("names that match nothing, or several shells, get a helpful error instead of a guess", async () => {
    const missing = await run("shell_read", { name: "redis" }, me()).catch((e: Error) => e.message)
    expect(missing).toContain('no shell matches "redis"')
    expect(missing).toContain("DB Monitoring")

    await run("shell_start", { command: "echo second; sleep 30", description: "DB Monitoring replica" }, me())
    const ambiguous = await run("shell_stop", { name: "DB" }, me()).catch((e: Error) => e.message)
    expect(ambiguous).toContain("matches several shells")
    expect(ambiguous).toContain("DB Monitoring replica")

    expect(await run("shell_stop", { name: "DB Monitoring" }, me())).toContain("killed")
    const needsTarget = await run("shell_read", {}, me()).catch((e: Error) => e.message)
    expect(needsTarget).toContain("pass the shell's id or name")
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
