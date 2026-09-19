import { describe, expect, test } from "bun:test"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { contextUsed } from "../src/core/context.ts"
import { buildContext, sessionSnapshot } from "../src/tui/state/snapshot.ts"

/** The adapter between OpenCode's live state and the snapshot every segment reads. */

const usage = (input: number, output = 0, cacheRead = 0) => ({
  input,
  output,
  reasoning: 0,
  cache: { read: cacheRead, write: 0 },
})

interface FakeState {
  messages?: unknown[]
  status?: { type: string; attempt?: number; message?: string; next?: number }
  diff?: { file: string; additions: number; deletions: number }[]
  todo?: { content: string; status: string }[]
  models?: Record<string, { cost?: { input: number; output: number }; limit?: { context: number } }>
  branch?: string
  route?: string
}

const api = (state: FakeState = {}): TuiPluginApi =>
  ({
    app: { version: "1.0.0" },
    renderer: { width: 100 },
    route: { current: { name: state.route ?? "session", params: { sessionID: "ses_1" } } },
    state: {
      path: { directory: "/w/app/src", worktree: "/w/app" },
      vcs: state.branch ? { branch: state.branch, default_branch: "main" } : undefined,
      provider: [{ id: "p", models: state.models ?? {} }],
      session: {
        get: () => ({ title: "A session", time: { created: 1000 } }),
        messages: () => state.messages ?? [],
        status: () => state.status ?? { type: "idle" },
        diff: () => state.diff ?? [],
        todo: () => state.todo ?? [],
      },
      lsp: () => [{ id: "tsserver", status: "connected" }],
      mcp: () => [{ name: "github", status: "failed" }],
    },
  }) as unknown as TuiPluginApi

const snapshot = (state: FakeState) => sessionSnapshot(api(state), "ses_1", 5000)

describe("token usage during a turn", () => {
  /**
   * The bug this guards: an assistant message that is still streaming reports zeroes, and taking
   * those blanked every token-based segment for the length of the turn -- the line appeared to
   * break exactly while you were watching it.
   */
  test("a message still streaming does not wipe the last real reading", () => {
    const settled = {
      role: "assistant",
      cost: 1,
      tokens: usage(1000, 500, 200),
      modelID: "m",
      providerID: "p",
    }
    const streaming = { role: "assistant", cost: 0, tokens: usage(0), modelID: "m", providerID: "p" }
    const mid = snapshot({ messages: [settled, streaming] })
    expect(contextUsed(mid.tokens)).toBe(1700)
  })

  test("a finished message replaces the previous reading", () => {
    const first = { role: "assistant", cost: 1, tokens: usage(1000), modelID: "m", providerID: "p" }
    const second = { role: "assistant", cost: 1, tokens: usage(4000), modelID: "m", providerID: "p" }
    expect(contextUsed(snapshot({ messages: [first, second] }).tokens)).toBe(4000)
  })

  test("cost is the whole session, not the last message", () => {
    const message = (cost: number) => ({
      role: "assistant",
      cost,
      tokens: usage(10),
      modelID: "m",
      providerID: "p",
    })
    expect(snapshot({ messages: [message(0.5), message(0.25)] }).cost).toBe(0.75)
  })

  test("a session with no assistant message yet has no tokens and no model", () => {
    const fresh = snapshot({ messages: [{ role: "user" }] })
    expect(fresh.tokens).toBeUndefined()
    expect(fresh.model).toBeUndefined()
  })
})

describe("what the provider catalogue supplies", () => {
  const message = { role: "assistant", cost: 1, tokens: usage(100), modelID: "m", providerID: "p" }

  test("a declared window and prices are carried through", () => {
    const priced = snapshot({
      messages: [message],
      models: { m: { cost: { input: 5, output: 25 }, limit: { context: 200_000 } } },
    })
    expect(priced.model?.contextLimit).toBe(200_000)
    expect(priced.priced).toBe(true)
  })

  // Behind a proxy the catalogue knows nothing, and neither should we claim to.
  test("an undeclared model is unpriced and has no window", () => {
    const proxied = snapshot({ messages: [message], models: { m: {} } })
    expect(proxied.model?.contextLimit).toBeUndefined()
    expect(proxied.priced).toBe(false)
  })

  test("zero prices count as undeclared rather than as free", () => {
    const zeroed = snapshot({ messages: [message], models: { m: { cost: { input: 0, output: 0 } } } })
    expect(zeroed.priced).toBe(false)
  })
})

describe("the rest of the session", () => {
  test("diff totals are summed across files", () => {
    const changed = snapshot({
      diff: [
        { file: "a", additions: 10, deletions: 2 },
        { file: "b", additions: 5, deletions: 1 },
      ],
    })
    expect(changed.diff).toEqual({ files: 2, additions: 15, deletions: 3 })
  })

  test("todos count only what is finished", () => {
    const todos = snapshot({
      todo: [
        { content: "a", status: "completed" },
        { content: "b", status: "pending" },
      ],
    })
    expect(todos.todo).toEqual({ total: 2, completed: 1 })
  })

  test("a retry carries its attempt and when the next one is due", () => {
    const retrying = snapshot({ status: { type: "retry", attempt: 2, message: "rate limited", next: 9000 } })
    expect(retrying.status).toBe("retry")
    expect(retrying.retry).toEqual({ attempt: 2, message: "rate limited", next: 9000 })
  })
})

describe("the whole context", () => {
  test("carries the branch, services and paths the segments read", () => {
    const ctx = buildContext(api({ branch: "status-bay" }), {
      now: 5000,
      width: 100,
      version: "0.2.2",
      commands: {},
    })
    expect(ctx.branch).toBe("status-bay")
    expect(ctx.defaultBranch).toBe("main")
    expect(ctx.directory).toBe("/w/app/src")
    expect(ctx.worktree).toBe("/w/app")
    expect(ctx.mcp).toEqual([{ name: "github", status: "failed" }])
    expect(ctx.session?.id).toBe("ses_1")
  })

  // Off a session route there is no session to report on.
  test("has no session when the interface is not showing one", () => {
    const ctx = buildContext(api({ route: "home" }), {
      now: 5000,
      width: 100,
      version: "0.2.2",
      commands: {},
    })
    expect(ctx.session).toBeUndefined()
  })
})
