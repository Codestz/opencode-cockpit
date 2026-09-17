import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import type { PluginInput } from "@opencode-ai/plugin"

// Isolate any daemon these plugins start from the developer's real one.
const home = mkdtempSync("/tmp/ck-dup-")
process.env.COCKPIT_HOME = home
process.env.COCKPIT_IDLE_TIMEOUT_MS = "0"

const { default: bundle } = await import("../src/server.ts")
const { default: shell } = await import("@opencode-cockpit/shell/server")
const { CockpitClient } = await import("@opencode-cockpit/client")

const logs: string[] = []
const fakeInput = () =>
  ({
    directory: "/tmp",
    worktree: "/tmp",
    client: { app: { log: async (req: { body: { message: string } }) => void logs.push(req.body.message) } },
  }) as unknown as PluginInput

afterAll(async () => {
  const c = new CockpitClient({ client: { name: "cleanup", version: "0" } })
  await c.call("daemon.shutdown", { force: true }).catch(() => {})
  c.close()
  rmSync(home, { recursive: true, force: true })
})

describe("configured twice in one OpenCode instance", () => {
  test("bundle first: its Shell wins, the standalone copy registers nothing and logs why", async () => {
    const input = fakeInput()
    const fromBundle = await bundle.server(input)
    const standalone = await shell.server(input)
    expect(Object.keys(fromBundle.tool ?? {})).toContain("shell_start")
    expect(standalone).toEqual({})
    await Bun.sleep(10)
    expect(logs.at(-1)).toContain("Shell is configured twice (opencode-cockpit and @opencode-cockpit/shell)")
    await fromBundle.dispose?.()
  })

  test("standalone first: the bundle skips Shell and exposes no duplicate tools", async () => {
    const input = fakeInput()
    const standalone = await shell.server(input)
    const fromBundle = await bundle.server(input)
    expect(Object.keys(standalone.tool ?? {})).toContain("shell_start")
    expect(fromBundle.tool).toBeUndefined()
    await standalone.dispose?.()
  })

  test("features switched off load nothing; separate instances each get Shell", async () => {
    expect(await bundle.server(fakeInput(), { features: { shell: false } })).toEqual({})
    const a = await bundle.server(fakeInput())
    const b = await bundle.server(fakeInput())
    expect(a.tool?.shell_start).toBeDefined()
    expect(b.tool?.shell_start).toBeDefined()
    await a.dispose?.()
    await b.dispose?.()
  })

  test("after dispose (plugin reload) Shell can be claimed again", async () => {
    const input = fakeInput()
    const first = await bundle.server(input)
    await first.dispose?.()
    const reloaded = await bundle.server(input)
    expect(reloaded.tool?.shell_start).toBeDefined()
    await reloaded.dispose?.()
  })
})
