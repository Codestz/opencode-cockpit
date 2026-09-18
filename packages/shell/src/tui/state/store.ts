import { existsSync } from "node:fs"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { CockpitClient } from "@opencode-cockpit/client"
import type { ScreenResult, ShellInfo } from "@opencode-cockpit/protocol/shell"
import { type Accessor, createEffect, createMemo, createRoot, createSignal, on, onCleanup } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { order, partition } from "../lib/view.ts"

export interface ShellStore {
  client: CockpitClient
  project: () => string
  /** Shells the panel is about: the current conversation, or the project. */
  shells: Accessor<ShellInfo[]>
  /** Every shell in the project, whatever the panel is showing. */
  all: Accessor<ShellInfo[]>
  /** Ordered and folded for display: running, recent failures, plus the selection. */
  visible: Accessor<ShellInfo[]>
  hidden: Accessor<ShellInfo[]>
  showAll: Accessor<boolean>
  toggleAll(): void
  /** Which shells the panel is about: the conversation you are in, or the whole project. */
  scope: Accessor<Scope>
  toggleScope(): void
  /** The session the interface is currently showing, when it is showing one. */
  session: Accessor<string | undefined>
  connected: Accessor<boolean>
  now: Accessor<number>
  /** Spinner frame index; advances only while something is running. */
  frame: Accessor<number>
  selected: Accessor<ShellInfo | undefined>
  select(id: string): void
  step(delta: number): void
  refresh(): Promise<void>
  clearFinished(): Promise<number>
  dispose(): void
}

/** A project's shells outnumber a conversation's, and mixing them is how the panel gets confusing. */
export type Scope = "session" | "project"

export interface StoreOptions {
  /** Failures stay in the default view this long after they end. */
  historyMinutes?: number
  /** What the panel lists by default. */
  scope?: Scope
}

export function createShellStore(
  api: TuiPluginApi,
  client: CockpitClient,
  options: StoreOptions = {},
): ShellStore {
  return createRoot((dispose) => {
    const [state, setState] = createStore<{ list: ShellInfo[] }>({ list: [] })
    const [connected, setConnected] = createSignal(false)
    const [now, setNow] = createSignal(Date.now())
    const [frame, setFrame] = createSignal(0)
    const [selectedId, setSelectedId] = createSignal<string>()
    const [showAll, setShowAll] = createSignal<boolean>(api.kv.get("cockpit.shells.showAll", false))
    const [scope, setScope] = createSignal<Scope>(
      api.kv.get("cockpit.shells.scope", options.scope ?? "session"),
    )
    const project = () => api.state.path.directory
    const session = () => {
      const route = api.route.current
      return route.name === "session" ? (route.params as { sessionID?: string }).sessionID : undefined
    }
    const historyMs = (options.historyMinutes ?? 30) * 60_000

    const refresh = async () => {
      try {
        const list = await client.call("shell.list", { owner: { project: project() } })
        setState("list", reconcile(list, { key: "id" }))
      } catch {
        // daemon not running yet; the reconnect loop will pick it up
      }
    }

    const offs = [
      client.on("shell.started", () => void refresh()),
      client.on("shell.exited", () => void refresh()),
      client.on("shell.removed", () => void refresh()),
      client.onState((s) => {
        setConnected(s === "connected")
        if (s === "connected") void refresh()
      }),
    ]

    // Connect only to a daemon that already exists; starting one is left to explicit actions.
    const probe = () => {
      if (!client.connected && existsSync(client.paths.socket)) void client.connect().catch(() => {})
    }
    probe()
    const probeTimer = setInterval(probe, 3000)
    const tick = setInterval(() => setNow(Date.now()), 1000)
    const spin = setInterval(() => {
      if (state.list.some((s) => s.status === "running")) setFrame((f) => f + 1)
    }, 120)
    onCleanup(() => {
      clearInterval(probeTimer)
      clearInterval(tick)
      clearInterval(spin)
      for (const off of offs) off()
    })

    const pick = createMemo(() => {
      const ordered = order(state.list)
      return ordered.find((s) => s.id === selectedId()) ?? ordered[0]
    })
    /** Everything the daemon knows about this project, narrowed to what the panel is about. */
    const inScope = createMemo(() => {
      const current = session()
      if (scope() === "project" || !current) return state.list
      return state.list.filter((shell) => shell.owner.session === current)
    })

    const folded = createMemo(() =>
      partition(inScope(), { showAll: showAll(), historyMs, now: now(), keep: pick()?.id }),
    )

    return {
      client,
      project,
      session,
      scope,
      toggleScope() {
        const next: Scope = scope() === "session" ? "project" : "session"
        setScope(next)
        api.kv.set("cockpit.shells.scope", next)
      },
      shells: () => inScope(),
      all: () => state.list,
      visible: () => folded().visible,
      hidden: () => folded().hidden,
      showAll,
      toggleAll() {
        const next = !showAll()
        setShowAll(next)
        api.kv.set("cockpit.shells.showAll", next)
      },
      connected,
      now,
      frame,
      selected: pick,
      select: (id) => setSelectedId(id),
      // Cycles every shell in the project: folding only exists to keep the sidebar short, and a
      // shell you cannot reach from the console would be a trap.
      step(delta) {
        const list = order(inScope())
        if (list.length === 0) return
        const index = Math.max(
          0,
          list.findIndex((s) => s.id === pick()?.id),
        )
        const next = list[(index + delta + list.length) % list.length]
        if (next) setSelectedId(next.id)
      },
      refresh,
      async clearFinished() {
        const { removed } = await client.call("shell.clear", { owner: { project: project() } })
        await refresh()
        return removed.length
      },
      dispose,
    }
  })
}

/**
 * Live terminal view of one shell: attaches for change notifications and re-renders the daemon's
 * emulated screen, throttled. Must be called inside a reactive owner.
 */
export function useScreen(store: ShellStore, id: Accessor<string | undefined>) {
  const [screen, setScreen] = createSignal<ScreenResult>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let current: string | undefined

  const fetch = (shellId: string) => {
    timer = undefined
    void store.client
      .call("shell.screen", { id: shellId })
      .then((s) => {
        if (current === shellId) setScreen(s)
      })
      .catch(() => {})
  }
  const schedule = (shellId: string) => {
    timer ??= setTimeout(() => fetch(shellId), 80)
  }

  const offOutput = store.client.on("shell.output", (e) => {
    if (e.id === current) schedule(e.id)
  })
  const offExit = store.client.on("shell.exited", (info) => {
    if (info.id === current) schedule(info.id)
  })

  const attach = (next: string | undefined) => {
    if (next === current) return
    if (current) void store.client.call("shell.detach", { id: current }).catch(() => {})
    current = next
    setScreen(undefined)
    if (!next) return
    // Not store.shells(): that is narrowed to the current conversation, and the selected shell may
    // sit outside it. A missing offset here is what used to ask the daemon for bytes past the end.
    const info = store.all().find((s) => s.id === next)
    void store.client
      .call("shell.attach", { id: next, fromOffset: info?.bytes ?? Number.MAX_SAFE_INTEGER })
      .catch(() => {})
    fetch(next)
  }

  createEffect(on(id, (next) => attach(next)))

  onCleanup(() => {
    clearTimeout(timer)
    offOutput()
    offExit()
    if (current) void store.client.call("shell.detach", { id: current }).catch(() => {})
  })

  return { screen, refetch: () => current && fetch(current) }
}
