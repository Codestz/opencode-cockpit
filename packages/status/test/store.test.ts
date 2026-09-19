import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createMemo, createRoot, createSignal } from "solid-js"
import type { StatusContext } from "../src/core/context.ts"
import { createStatusStore, type StatusStore } from "../src/tui/state/store.ts"

/**
 * solid-js resolves to its SSR build under Bun's default "node" condition, where signals never
 * propagate. Run with `bun run test`, which passes `--conditions browser`.
 */
beforeAll(() => {
  const reactive = createRoot((dispose) => {
    const [n, setN] = createSignal(0)
    const doubled = createMemo(() => n() * 2)
    setN(1)
    const ok = doubled() === 2
    dispose()
    return ok
  })
  if (!reactive) throw new Error("solid-js is not reactive here — run: bun test --conditions browser")
})

const api = { renderer: { width: 100 } } as unknown as TuiPluginApi

interface Harness {
  store: StatusStore
  built: number
  runs: string[]
  advance(ms: number): void
  settle(): Promise<void>
}

function harness(config: Parameters<typeof createStatusStore>[1] = {}, exec?: () => Promise<string>) {
  let clock = 0
  const state = { built: 0, runs: [] as string[] }
  const store = createStatusStore(api, config, {
    version: "9.9.9",
    now: () => clock,
    exec: async (command) => {
      state.runs.push(command)
      return exec ? await exec() : "out"
    },
    build: (_api, input) => {
      state.built++
      return { ...base, now: input.now, width: input.width, version: input.version, commands: input.commands }
    },
  })
  return {
    store,
    get built() {
      return state.built
    },
    runs: state.runs,
    advance: (ms: number) => {
      clock += ms
    },
    settle: () => new Promise<void>((done) => setTimeout(done, 0)),
  } as Harness
}

const base: StatusContext = {
  now: 0,
  directory: "/w/app",
  worktree: "/w/app",
  home: "/home/u",
  version: "0",
  lsp: [],
  mcp: [],
  commands: {},
  width: 0,
}

let live: Harness | undefined
afterEach(() => {
  live?.store.dispose()
  live = undefined
})

describe("the snapshot every line reads", () => {
  test("is built from the plugin api and carries what the store was told", () => {
    live = harness()
    const ctx = live.store.context()
    expect(ctx.version).toBe("9.9.9")
    expect(ctx.width).toBe(100)
  })

  // One memo for the whole line rather than one per segment: reading it twice must not rebuild it.
  test("is computed once per change, not once per reader", () => {
    live = harness()
    live.store.context()
    live.store.context()
    expect(live.built).toBe(1)
  })
})

describe("commands run off the draw path", () => {
  test("a configured command runs when the snapshot is first read", async () => {
    live = harness({ commands: { probe: { run: "echo hi" } } })
    live.store.context()
    await live.settle()
    expect(live.runs).toEqual(["echo hi"])
  })

  test("its output reaches the snapshot once it finishes", async () => {
    live = harness({ commands: { probe: { run: "echo hi" } } })
    expect(live.store.context().commands.probe).toBe("")
    await live.settle()
    expect(live.store.context().commands.probe).toBe("out")
  })

  // A failing script must not empty the line; the last good value stands.
  test("a failing command leaves the snapshot alone", async () => {
    let fail = false
    live = harness({ commands: { probe: { run: "x", intervalMs: 250 } } }, async () => {
      if (fail) throw new Error("boom")
      return "good"
    })
    live.store.context()
    await live.settle()
    expect(live.store.context().commands.probe).toBe("good")

    fail = true
    live.advance(300)
    live.store.context()
    await live.settle()
    expect(live.store.context().commands.probe).toBe("good")
  })

  test("no commands configured means no shell is ever spawned", async () => {
    live = harness()
    live.store.context()
    await live.settle()
    expect(live.runs).toEqual([])
  })
})

describe("disposal", () => {
  test("stops the clock and the commands", async () => {
    live = harness({ commands: { probe: { run: "x", intervalMs: 250 } } })
    live.store.context()
    await live.settle()
    const before = live.runs.length

    live.store.dispose()
    live.advance(10_000)
    await live.settle()
    expect(live.runs.length).toBe(before)
    live = undefined
  })
})
