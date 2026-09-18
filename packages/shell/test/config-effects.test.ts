import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin"
import { startDaemon } from "../../client/test/helpers.ts"
import { createTools } from "../src/agent/tools/index.ts"
import type { CockpitConfig } from "../src/core/config.ts"

/**
 * Settings are only worth having if they change what the agent's tools do, so these drive the real
 * tools against a real daemon with a config in place, and assert the observable difference.
 */
const CONFIG: CockpitConfig = {
  kinds: { e2e: "playwright|cypress" },
  watch: { presets: { e2e: { done: "\\d+ (passed|failed)", fail: "\\d+ failed" } } },
  defaults: { logFile: true, notifyOnExit: false, timeoutSeconds: 30 },
}

let env: Awaited<ReturnType<typeof startDaemon>>
let tools: ReturnType<typeof createTools>
const quiet = new Set<string>()

const ctx = (): ToolContext => ({
  sessionID: "ses_cfg",
  messageID: "msg_1",
  agent: "build",
  directory: "/tmp",
  worktree: "/tmp",
  abort: new AbortController().signal,
  metadata() {},
  async ask() {},
})

type RawTool = { execute(args: unknown, context: ToolContext): Promise<string> }
const run = (name: string, args: Record<string, unknown>) =>
  (tools[name] as unknown as RawTool).execute(args, ctx())
const idOf = (out: string) => (/sh_[a-z2-7]{8}/.exec(out) as RegExpExecArray)[0]

beforeAll(async () => {
  env = await startDaemon()
  tools = createTools({
    client: env.client("config"),
    instance: "inst",
    quiet,
    config: CONFIG,
    env: () => ({ PATH: process.env.PATH ?? "" }),
    sessionTitle: async () => undefined,
    shellCommand: (command) => ({ command: "/bin/bash", args: ["--noprofile", "--norc", "-c", command] }),
  })
})
afterAll(async () => {
  await env.dispose()
})

describe("config changes what the tools do", () => {
  test("defaults fill in what the call left out, and an explicit argument still wins", async () => {
    const out = await run("shell_start", { command: "echo hi; sleep 30", description: "defaults apply" })
    expect(out).toContain("log file:") // defaults.logFile
    expect(quiet.has(idOf(out))).toBe(true) // defaults.notifyOnExit: false

    const loud = await run("shell_start", {
      command: "echo hi; sleep 30",
      description: "explicit wins",
      notifyOnExit: true,
      logFile: false,
    })
    expect(loud).not.toContain("log file:")
    expect(quiet.has(idOf(loud))).toBe(false)
  })

  test("a preset from config is sent as a rule, so the daemon accepts a name it has never heard of", async () => {
    const id = idOf(await run("shell_start", { command: "sleep 30", description: "watch me" }))
    const out = await run("shell_watch", { id, preset: "e2e" })
    expect(out).toContain("custom rule") // resolved locally, not a daemon preset
    expect(await run("shell_watch", { id, preset: "tsc" })).toContain("(tsc)") // built-ins still work
  })

  test("a kind from config classifies commands and can be filtered on", async () => {
    await run("shell_start", { command: "playwright test --ui; sleep 30", description: "e2e suite" })
    const listed = await run("shell_list", { kind: "e2e" })
    expect(listed).toContain("· e2e ·")
    expect(listed).not.toContain("defaults apply")
  })

  test("watch.auto attaches a watcher to a new shell without being asked", async () => {
    const auto = createTools({
      client: env.client("auto"),
      instance: "inst",
      quiet,
      config: { watch: { auto: true } },
      env: () => ({ PATH: process.env.PATH ?? "" }),
      sessionTitle: async () => undefined,
      shellCommand: (command) => ({ command: "/bin/bash", args: ["--noprofile", "--norc", "-c", command] }),
    })
    const out = await (auto.shell_start as unknown as RawTool).execute(
      { command: "tsc --watch; sleep 30", description: "auto watched" },
      ctx(),
    )
    expect(out).toContain("watching health")
  })
})
