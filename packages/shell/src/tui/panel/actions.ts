/**
 * Everything the console *does*, at either size — Review's `panel/actions.ts`, for Shell.
 *
 * One verb per thing a person can ask for; each changes the surface and asks for a paint. The dialog
 * and full screen share these, so a key cannot work in one and not the other. Nothing here knows
 * which key it is bound to; that table is `keys.ts`.
 */

import type { Notice } from "../lib/console.ts"
import { friendlyError } from "../lib/search.ts"
import { kindOf } from "../lib/view.ts"
import type { ShellStore } from "../state/store.ts"
import type { Surface } from "./surface.ts"

export interface ActionDeps {
  store: ShellStore
  surface: Surface
  draw: () => void
  /** How far up the view can scroll. */
  most: () => number
  close: () => void
  /** Between the dialog and the whole window. */
  resize: () => void
  newShell: () => void
}

export interface Actions {
  type: () => void
  interrupt: () => void
  restart: () => void
  stop: () => void
  remove: () => void
  clearFinished: () => void
  swapView: () => void
  details: () => void
  search: () => void
  clearFilter: () => void
  /** Positive scrolls toward the output, negative back through history. */
  scroll: (delta: number) => void
  follow: () => void
  top: () => void
  next: () => void
  prev: () => void
  scope: () => void
  newShell: () => void
  resize: () => void
  close: () => void
  /** Says something in the key row for a while. */
  flash: (text: string, tone: Notice["tone"], ms?: number) => void
}

/** Far enough back for anything the daemon keeps. */
export const HISTORY = 2000

export function createActions(deps: ActionDeps): Actions {
  const { store, surface, draw } = deps
  const client = store.client
  const shell = () => store.selected()
  const set = (change: Partial<Surface>) => {
    Object.assign(surface, change)
    draw()
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  const flash = (text: string, tone: Notice["tone"], ms?: number) => {
    clearTimeout(timer)
    set({ notice: { text, tone } })
    if (ms) timer = setTimeout(() => set({ notice: undefined }), ms)
  }
  /** Says it is doing it, then what happened — a daemon error phrased for a person. */
  const act = (label: string, fn: () => Promise<unknown>) => {
    flash(`${label}…`, "info")
    fn()
      .then((result) =>
        typeof result === "string" ? flash(result, "success", 2500) : set({ notice: undefined }),
      )
      .catch((err) => flash(`${label} failed: ${friendlyError(err)}`, "error", 5000))
  }
  /** Actions that need a live process explain themselves instead of failing. */
  const whileRunning = (label: string, fn: (id: string) => void) => () => {
    const s = shell()
    if (!s) return
    if (s.status !== "running") {
      flash(
        `can't ${label}: this shell already ${kindOf(s) === "done" ? "finished" : "ended"} · r runs it again`,
        "info",
        3000,
      )
      return
    }
    fn(s.id)
  }
  const withShell = (fn: (id: string) => void) => () => {
    const id = shell()?.id
    if (id) fn(id)
  }
  /** Deferred: these dispose the key layer that is dispatching them, as Review's close is. */
  const later = (fn: () => void) => () => setTimeout(fn, 0)
  const toggleView = (next: Surface["view"]) => set({ view: surface.view === next ? "screen" : next, up: 0 })

  return {
    flash,
    type: whileRunning("type", () => set({ typing: true, view: "screen", up: 0 })),
    interrupt: whileRunning("interrupt", (id) =>
      act("interrupt", async () => {
        await client.call("shell.write", { id, data: "\x03" })
        return "sent ctrl+c"
      }),
    ),
    restart: withShell((id) => act("restart", () => client.call("shell.restart", { id }))),
    stop: whileRunning("stop", (id) =>
      act("stop", async () => {
        await client.call("shell.stop", { id, signal: "SIGTERM", graceMs: 3000 })
        return "stopped"
      }),
    ),
    remove: withShell((id) => act("remove", () => client.call("shell.remove", { id }))),
    clearFinished: () => {
      if (!store.shells().some((s) => s.status !== "running"))
        return flash("nothing to clear: no finished shells", "info", 2500)
      act("clear", async () => {
        const n = await store.clearFinished()
        return `cleared ${n} finished shell${n === 1 ? "" : "s"}`
      })
    },
    swapView: () => set({ view: surface.view === "log" ? "screen" : "log", up: 0 }),
    details: () => toggleView("details"),
    search: () => set({ view: "log", draft: surface.filter, searching: true, up: 0 }),
    clearFilter: () => set({ filter: "", draft: "" }),
    scroll: (delta) => set({ up: Math.max(0, Math.min(surface.up, deps.most()) - delta) }),
    follow: () => set({ up: 0 }),
    top: () => set({ up: HISTORY }),
    next: () => {
      store.step(1)
      set({ up: 0 })
    },
    prev: () => {
      store.step(-1)
      set({ up: 0 })
    },
    scope: () => {
      store.toggleScope()
      draw()
    },
    newShell: later(() => {
      deps.close()
      deps.newShell()
    }),
    resize: later(() => deps.resize()),
    close: later(() => deps.close()),
  }
}
