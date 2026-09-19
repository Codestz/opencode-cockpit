import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { CockpitClient } from "@opencode-cockpit/client"
import type { ShellInfo } from "@opencode-cockpit/protocol/shell"
import { createMemo, createRoot, createSignal } from "solid-js"
import { createShellStore, type ShellStore, useScreen } from "../src/tui/state/store.ts"

/**
 * solid-js resolves to its SSR build under Bun's default "node" condition, and in that build
 * signals never propagate: every memo is frozen at its first value and the store looks permanently
 * empty. The TUI runs the client build, so the suite must too — `bun test --conditions browser`,
 * which is what `bun run test` and CI do. Fail loudly rather than as seven puzzling diffs.
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

/**
 * The panel narrows the daemon's list to the conversation you are looking at. Getting that wrong is
 * how manual shells vanished from the list — and then how attaching to one asked the daemon for
 * bytes past the end of its buffer. These drive the real store against a fake daemon.
 */

let seq = 0
const shell = (over: Partial<ShellInfo> & { session?: string }): ShellInfo => {
  const { session, ...rest } = over
  return {
    id: `sh_${String(seq++).padStart(8, "a")}`,
    title: "t",
    command: "/bin/zsh",
    args: ["-c", "npm test"],
    cwd: "/p",
    owner: { project: "/p", session },
    status: "running",
    run: 1,
    startedAt: 1000,
    cols: 80,
    rows: 24,
    lines: { first: 1, last: 0 },
    bytes: 0,
    ...rest,
  }
}

interface Harness {
  store: ShellStore
  kv: Map<string, unknown>
  calls: { method: string; params: unknown }[]
  setRoute(sessionID: string | undefined): void
  setList(list: ShellInfo[]): Promise<void>
  emit(topic: string, data: unknown): void
}

function harness(list: ShellInfo[] = [], options: Parameters<typeof createShellStore>[2] = {}): Harness {
  const kv = new Map<string, unknown>()
  const calls: { method: string; params: unknown }[] = []
  let current = list
  let route: { name: string; params: Record<string, unknown> } = {
    name: "session",
    params: { sessionID: "ses_a" },
  }

  const api = {
    kv: {
      get: (key: string, fallback: unknown) => (kv.has(key) ? kv.get(key) : fallback),
      set: (key: string, value: unknown) => void kv.set(key, value),
    },
    state: { path: { directory: "/p" } },
    get route() {
      return { current: route }
    },
  } as unknown as TuiPluginApi

  const handlers = new Map<string, Set<(data: unknown) => void>>()
  const client = {
    connected: true,
    paths: { socket: "/nonexistent/cockpit.sock" },
    call: async (method: string, params: unknown) => {
      calls.push({ method, params })
      if (method === "shell.list") return current
      if (method === "shell.clear") return { removed: current.filter((s) => s.status !== "running") }
      if (method === "shell.screen") return { text: "hi", runs: [], cursor: { x: 0, y: 0 } }
      return {}
    },
    on: (topic: string, fn: (data: unknown) => void) => {
      const set = handlers.get(topic) ?? new Set()
      handlers.set(topic, set)
      set.add(fn)
      return () => void set.delete(fn)
    },
    onState: () => () => {},
  } as unknown as CockpitClient

  const store = createShellStore(api, client, options)
  return {
    store,
    kv,
    calls,
    emit: (topic, data) => {
      for (const fn of handlers.get(topic) ?? []) fn(data)
    },
    setRoute: (sessionID) => {
      route = sessionID ? { name: "session", params: { sessionID } } : { name: "home", params: {} }
    },
    setList: async (next) => {
      current = next
      await store.refresh()
    },
  }
}

let live: Harness | undefined
afterEach(() => {
  live?.store.dispose()
  live = undefined
})

describe("what the panel is about", () => {
  test("session scope lists only this conversation's shells, project scope lists them all", async () => {
    const mine = shell({ session: "ses_a", title: "mine" })
    const theirs = shell({ session: "ses_b", title: "theirs" })
    live = harness()
    await live.setList([mine, theirs])

    expect(live.store.shells().map((s) => s.title)).toEqual(["mine"])
    // `all` is the escape hatch every surface that reaches outside the panel depends on.
    expect(live.store.all()).toHaveLength(2)

    live.store.toggleScope()
    expect(live.store.scope()).toBe("project")
    expect(live.store.shells()).toHaveLength(2)
  })

  // The regression: a shell started from the panel carried no session, so the scoped list dropped
  // it the moment it was created — and attaching to the shell you had just made then crashed.
  test("a shell that names this session is kept, one with no session at all is not", async () => {
    const owned = shell({ session: "ses_a" })
    const orphan = shell({})
    live = harness()
    await live.setList([owned, orphan])

    expect(live.store.shells().map((s) => s.id)).toEqual([owned.id])
    expect(live.store.all().map((s) => s.id)).toContain(orphan.id)
  })

  // Outside a conversation there is nothing to narrow to; showing an empty panel would read as
  // "you have no shells", which is a lie.
  test("off a session route the panel falls back to the whole project", async () => {
    live = harness()
    await live.setList([shell({ session: "ses_a" }), shell({ session: "ses_b" })])
    live.setRoute(undefined)
    // The route is read through a memo; a refresh is what makes the panel look again.
    await live.setList([shell({ session: "ses_a" }), shell({ session: "ses_b" })])

    expect(live.store.shells()).toHaveLength(2)
  })

  test("the chosen scope is remembered, and an explicit default is honoured", async () => {
    live = harness([], { scope: "project" })
    expect(live.store.scope()).toBe("project")
    live.store.toggleScope()
    expect(live.kv.get("cockpit.shells.scope")).toBe("session")
    live.store.dispose()

    const again = harness([], { scope: "project" })
    live = again
    expect(again.store.scope()).toBe("project")
  })
})

describe("selection", () => {
  test("defaults to the first shell in display order and survives a refresh", async () => {
    const running = shell({ session: "ses_a", title: "running", startedAt: 100 })
    const done = shell({ session: "ses_a", title: "done", status: "exited", exitCode: 0, endedAt: 200 })
    live = harness()
    await live.setList([done, running])

    expect(live.store.selected()?.title).toBe("running")
    live.store.select(done.id)
    expect(live.store.selected()?.title).toBe("done")
    await live.setList([done, running])
    expect(live.store.selected()?.title).toBe("done")
  })

  test("stepping wraps in both directions", async () => {
    const a = shell({ session: "ses_a", startedAt: 100 })
    const b = shell({ session: "ses_a", startedAt: 200 })
    live = harness()
    await live.setList([a, b])

    expect(live.store.selected()?.id).toBe(a.id)
    live.store.step(1)
    expect(live.store.selected()?.id).toBe(b.id)
    live.store.step(1)
    expect(live.store.selected()?.id).toBe(a.id)
    live.store.step(-1)
    expect(live.store.selected()?.id).toBe(b.id)
  })

  test("stepping an empty list does nothing rather than throwing", () => {
    live = harness()
    expect(() => live?.store.step(1)).not.toThrow()
    expect(live.store.selected()).toBeUndefined()
  })
})

describe("folding", () => {
  test("finished shells fold away, and showAll unfolds them", async () => {
    const running = shell({ session: "ses_a", startedAt: 100 })
    const old = shell({
      session: "ses_a",
      status: "exited",
      exitCode: 0,
      startedAt: 0,
      endedAt: Date.now() - 60 * 60_000,
    })
    live = harness([], { historyMinutes: 1 })
    await live.setList([running, old])

    expect(live.store.visible().map((s) => s.id)).toEqual([running.id])
    expect(live.store.hidden().map((s) => s.id)).toEqual([old.id])

    live.store.toggleAll()
    expect(live.store.showAll()).toBe(true)
    expect(live.store.visible()).toHaveLength(2)
    expect(live.store.hidden()).toHaveLength(0)
    expect(live.kv.get("cockpit.shells.showAll")).toBe(true)
  })

  // Folding is a display convenience; it must never hide the shell the console is showing.
  test("the selected shell stays visible even when it would fold", async () => {
    const running = shell({ session: "ses_a", startedAt: 100 })
    const old = shell({
      session: "ses_a",
      status: "exited",
      exitCode: 0,
      startedAt: 0,
      endedAt: Date.now() - 60 * 60_000,
    })
    live = harness([], { historyMinutes: 1 })
    await live.setList([running, old])
    live.store.select(old.id)

    expect(live.store.visible().map((s) => s.id)).toContain(old.id)
    expect(live.store.hidden()).toHaveLength(0)
  })
})

describe("talking to the daemon", () => {
  test("the list is always asked for by project", async () => {
    live = harness()
    await live.setList([])
    expect(live.calls.at(-1)).toEqual({ method: "shell.list", params: { owner: { project: "/p" } } })
  })

  test("clearing reports how many went and refreshes", async () => {
    live = harness()
    await live.setList([shell({ session: "ses_a", status: "exited", exitCode: 0 })])
    const removed = await live.store.clearFinished()
    expect(removed).toBe(1)
    expect(live.calls.map((c) => c.method)).toContain("shell.clear")
  })

  // A daemon that is not up yet is the normal state at startup, not an error to surface.
  test("a failing list leaves the panel as it was", async () => {
    live = harness()
    await live.setList([shell({ session: "ses_a" })])
    const before = live.store.all()

    live.store.client.call = (async () => {
      throw new Error("cockpitd is not running")
    }) as CockpitClient["call"]
    await live.store.refresh()

    expect(live.store.all()).toEqual(before)
  })
})

describe("attaching the live terminal", () => {
  const view = (h: Harness, id: () => string | undefined) =>
    createRoot((dispose) => ({ screen: useScreen(h.store, id), dispose }))

  const attachCalls = (h: Harness) => h.calls.filter((c) => c.method === "shell.attach")

  test("resumes from the bytes the panel already knows about", async () => {
    const a = shell({ session: "ses_a", bytes: 4096 })
    live = harness()
    await live.setList([a])
    const [id] = createSignal<string | undefined>(a.id)
    const v = view(live, id)

    expect(attachCalls(live).at(-1)?.params).toEqual({ id: a.id, fromOffset: 4096 })
    v.dispose()
  })

  /**
   * The crash this guards: the panel's list is narrowed to one conversation, but the console can
   * be showing a shell from outside it. Looking the offset up in the narrowed list found nothing,
   * so attach asked for MAX_SAFE_INTEGER and the daemon's ring buffer computed a negative length.
   */
  test("a shell outside the current conversation still attaches at its own offset", async () => {
    const elsewhere = shell({ session: "ses_b", bytes: 128 })
    live = harness()
    await live.setList([elsewhere])
    expect(live.store.shells()).toHaveLength(0) // not in this conversation's panel
    expect(live.store.all()).toHaveLength(1)

    const [id] = createSignal<string | undefined>(elsewhere.id)
    const v = view(live, id)

    expect(attachCalls(live).at(-1)?.params).toEqual({ id: elsewhere.id, fromOffset: 128 })
    v.dispose()
  })

  test("a shell the daemon never reported falls back rather than throwing", async () => {
    live = harness()
    await live.setList([])
    const [id] = createSignal<string | undefined>("sh_unknown1")
    const v = view(live, id)

    expect(attachCalls(live).at(-1)?.params).toEqual({
      id: "sh_unknown1",
      fromOffset: Number.MAX_SAFE_INTEGER,
    })
    v.dispose()
  })

  test("switching shells detaches the one it leaves, and leaving detaches the last", async () => {
    const a = shell({ session: "ses_a", bytes: 1 })
    const b = shell({ session: "ses_a", bytes: 2 })
    live = harness()
    await live.setList([a, b])
    const [id, setId] = createSignal<string | undefined>(a.id)
    const v = view(live, id)

    setId(b.id)
    const detaches = live.calls.filter((c) => c.method === "shell.detach")
    expect(detaches.map((c) => (c.params as { id: string }).id)).toEqual([a.id])
    expect(attachCalls(live).map((c) => (c.params as { id: string }).id)).toEqual([a.id, b.id])

    v.dispose()
    expect(live.calls.filter((c) => c.method === "shell.detach")).toHaveLength(2)
  })

  test("output redraws the screen, and a burst costs one fetch", async () => {
    const a = shell({ session: "ses_a" })
    live = harness()
    await live.setList([a])
    const [id] = createSignal<string | undefined>(a.id)
    const v = view(live, id)
    await Bun.sleep(1)
    const before = live.calls.filter((c) => c.method === "shell.screen").length

    for (let i = 0; i < 5; i++) live.emit("shell.output", { id: a.id })
    await Bun.sleep(120)
    expect(live.calls.filter((c) => c.method === "shell.screen").length).toBe(before + 1)
    expect(v.screen.screen()?.text).toBe("hi")

    // Output from a shell you are not watching must not repaint the one you are.
    live.emit("shell.output", { id: "sh_other12" })
    await Bun.sleep(120)
    expect(live.calls.filter((c) => c.method === "shell.screen").length).toBe(before + 1)
    v.dispose()
  })

  test("an exit repaints so the final output is what stays on screen", async () => {
    const a = shell({ session: "ses_a" })
    live = harness()
    await live.setList([a])
    const [id] = createSignal<string | undefined>(a.id)
    const v = view(live, id)
    await Bun.sleep(1)
    const before = live.calls.filter((c) => c.method === "shell.screen").length

    live.emit("shell.exited", { id: a.id, status: "exited", exitCode: 0 })
    await Bun.sleep(120)
    expect(live.calls.filter((c) => c.method === "shell.screen").length).toBe(before + 1)
    v.dispose()
  })
})
