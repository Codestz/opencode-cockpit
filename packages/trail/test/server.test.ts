import { afterAll, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ToolContext, ToolDefinition } from "@opencode-ai/plugin"
import { silentLog } from "@opencode-cockpit/client/log"
import type { ServerHost, ServerParts } from "@opencode-cockpit/client/server"
import { createTrailServer, SEEN_FOR_MS } from "../src/agent/plugin.ts"
import { GUIDANCE } from "../src/core/text.ts"

/**
 * The agent half as a model meets it: a fake OpenCode holding a conversation with a subagent, the
 * tools called as the model calls them, and the lines each request is given. The trail file is real,
 * in a folder of its own.
 */

const ROOT = "ses_root"
const CHILD = "ses_child"
const sessions: Record<string, { parentID?: string; title?: string }> = {
  [ROOT]: { title: "Fix the checkout" },
  [CHILD]: { parentID: ROOT, title: "Open the PR (@general subagent)" },
  ses_other: { title: "Another conversation" },
}

const home = mkdtempSync(join(tmpdir(), "trail-server-"))
const saved = { COCKPIT_HOME: process.env.COCKPIT_HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME }
process.env.COCKPIT_HOME = join(home, "data")
/** No settings file but the test's own: the person running the tests keeps theirs. */
process.env.XDG_CONFIG_HOME = join(home, "config")
afterAll(() => {
  for (const [key, value] of Object.entries(saved))
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  rmSync(home, { recursive: true, force: true })
})

let project = ""
beforeEach(() => {
  project = mkdtempSync(join(home, "project-"))
})

function host(directory = project): ServerHost {
  return {
    version: 1,
    directory,
    scope: {},
    log: silentLog,
    readFile: async () => undefined,
    session: {
      get: async (id) => sessions[id],
      notify: async () => {},
    },
  }
}

const context = (sessionID: string, agent = "build") => ({ sessionID, agent }) as unknown as ToolContext
const call = async (parts: ServerParts, name: string, args: unknown, sessionID = ROOT, agent?: string) => {
  const def = parts.tools?.[name]
  if (!def) throw new Error(`no tool ${name}`)
  return String(await (def as ToolDefinition).execute(args as never, context(sessionID, agent)))
}
const start = async (options?: unknown, at = host()) => createTrailServer({ source: "test" })(at, options)

describe("the tools", () => {
  test("trail_add records, and trail_list reads it back the same", async () => {
    const parts = await start()
    const added = await call(parts, "trail_add", {
      title: "Fix the checkout",
      url: "https://github.com/acme/web/pull/40",
      for: "COM-1",
    })
    expect(added).toContain('Recorded PR #40 "Fix the checkout" (GitHub) — created.')
    const listed = await call(parts, "trail_list", {})
    expect(listed).toContain('PR #40 "Fix the checkout"')
    expect(listed).toContain("https://github.com/acme/web/pull/40")
  })

  test("a refusal says what to send, and nothing is written", async () => {
    const parts = await start()
    expect(await call(parts, "trail_add", { title: "No link" })).toContain("Nothing was recorded.")
    expect(await call(parts, "trail_list", {})).toContain("Nothing is in this conversation's trail yet.")
  })

  test("a subagent's record belongs to the conversation, and remembers the subagent", async () => {
    const parts = await start()
    await call(parts, "trail_add", { title: "Docs", url: "https://acme.dev/docs/1" }, CHILD, "general")
    const listed = await call(parts, "trail_list", {})
    expect(listed).toContain('"Docs"')
    expect(listed).toContain("by subagent general")
    const all = await call(parts, "trail_list", { all: true }, "ses_other")
    expect(all).toContain('in "Fix the checkout" (ses_root)')
  })

  test("another window's records are read from the same file", async () => {
    const one = await start(undefined, host())
    const two = createTrailServer({ source: "test-2" })
    const other = await two(host(project), undefined)
    await call(one, "trail_add", { title: "From one", url: "https://acme.dev/one" })
    expect(await call(other, "trail_list", {})).toContain('"From one"')
  })
})

describe("every request", () => {
  test("the guidance, always — subagents and unknown sessions too", async () => {
    const parts = await start()
    expect(await parts.system?.(undefined)).toEqual([GUIDANCE])
    expect(await parts.system?.(CHILD)).toEqual([GUIDANCE])
  })

  test("what the conversation produced, rebuilt from the file — in the subagent's requests too", async () => {
    const parts = await start()
    await call(parts, "trail_add", { title: "Fix the checkout", url: "https://github.com/acme/web/pull/40" })
    const lines = (await parts.system?.(CHILD)) ?? []
    expect(lines[1]).toBe('Trail — this conversation produced: PR #40 "Fix the checkout" (created).')
    /** A fresh start, as after a restart or a compaction: the same line, from the file alone. */
    const again = await start()
    expect((await again.system?.(ROOT))?.[1]).toBe(lines[1])
  })

  test("a PR link printed by a command is put to the agent as a choice, until recorded", async () => {
    const parts = await start()
    await parts.toolAfter?.({
      sessionID: CHILD,
      tool: "bash",
      callID: "c1",
      args: {},
      output: "Creating pull request for feat into main\n\nhttps://github.com/acme/web/pull/41\n",
    })
    const seen = (await parts.system?.(ROOT))?.at(-1)
    expect(seen).toBe(
      "Seen in output — record it with tools.trail_add if you created or changed it: https://github.com/acme/web/pull/41",
    )
    await call(parts, "trail_add", { title: "Checkout", url: "https://github.com/acme/web/pull/41" })
    expect((await parts.system?.(ROOT))?.join("\n")).not.toContain("Seen in output")
  })

  test("MCP output counts; a file read or a page fetched does not", async () => {
    const parts = await start()
    const after = (tool: string, output: string) =>
      parts.toolAfter?.({ sessionID: ROOT, tool, callID: tool, args: {}, output })
    await after("read", "see https://github.com/acme/web/pull/1")
    await after("webfetch", "https://github.com/acme/web/issues/2")
    await after("task", "the subagent said https://github.com/acme/web/pull/3")
    await after("github_create_issue", "Created https://github.com/acme/web/issues/4")
    const seen = (await parts.system?.(ROOT))?.at(-1) ?? ""
    expect(seen).toContain("/issues/4")
    for (const n of ["/pull/1", "/issues/2", "/pull/3"]) expect(seen).not.toContain(n)
  })

  test("a link seen long ago is no longer put to the agent", async () => {
    const parts = await start()
    const real = Date.now
    Date.now = () => real() - SEEN_FOR_MS - 1000
    try {
      await parts.toolAfter?.({
        sessionID: ROOT,
        tool: "bash",
        callID: "x",
        args: {},
        output: "https://github.com/a/b/pull/9",
      })
    } finally {
      Date.now = real
    }
    expect((await parts.system?.(ROOT))?.join("\n")).not.toContain("Seen in output")
  })
})

describe("settings", () => {
  test("enabled: false in the project's file: no tools, no guidance", async () => {
    writeFileSync(join(project, ".cockpit.json"), '{ "trail": { "enabled": false } }')
    expect(await start()).toEqual({})
  })

  test("features.trail: false in a file does the same", async () => {
    writeFileSync(join(project, ".cockpit.json"), '{ "features": { "trail": false } }')
    expect(await start()).toEqual({})
  })
})

describe("a deleted conversation", () => {
  test("keeps its records, marked", async () => {
    const parts = await start()
    await call(parts, "trail_add", { title: "Kept", url: "https://acme.dev/kept" })
    await parts.sessionDeleted?.(ROOT)
    expect(await call(parts, "trail_list", { all: true }, "ses_other")).toContain("(ses_root, deleted)")
  })
})
