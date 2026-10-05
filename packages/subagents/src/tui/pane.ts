/**
 * The pane: one subagent at a time, half the window or all of it. Opening and closing it, moving
 * between subagents and through the items, folding, scrolling, stopping, removing, moving to the
 * background — and the keys it takes only while it is up.
 */

import type { Host, Layer } from "@opencode-cockpit/client/host"
import type { Log } from "@opencode-cockpit/client/log"
import { applyAll, type Model, type Node, type Session } from "../core/model/model.ts"
import type { Messages } from "./messages.ts"
import type { Painter } from "./paint.ts"
import type { Source } from "./source.ts"
import type { Surface } from "./surface.ts"

export const FULL_KEY = "cockpit.subagents.full"
/** Thinking shown or folded — shown until you say otherwise, then as you left it. */
export const THINKING_KEY = "cockpit.subagents.thinking"
/** How long the second `x` that confirms a stop is waited for. */
const CONFIRM_MS = 4_000

export interface Pane {
  open(id: string): void
  close(): void
  scroll(by: number): void
  click(y: number): void
  /** From anywhere: the working subagent, or the latest one, of the conversation on screen. */
  openLatest(): void
  clearFinished(): void
  restore(): void
  dispose(): void
}

export function createPane(input: {
  api: Host
  log: Log
  model: Model
  surface: Surface
  painter: Painter
  messages: Messages
  feed: Source
  /** Subagents removed from the list by hand, kept across restarts. */
  hidden: Set<string>
  saveHidden: () => void
  isHidden: (id: string) => boolean
  nodes: () => Node[]
  opened: () => Session | undefined
  busy: (session: Session) => boolean
  /** The conversation on screen, looked at again. */
  follow: () => void
  set: (change: Partial<Surface>) => void
}): Pane {
  const { api, log, model, surface, painter, messages, feed, hidden, saveHidden, isHidden } = input
  const { nodes, opened, busy, follow, set } = input
  const draw = painter.draw
  let disposeKeys: (() => void) | undefined
  let fast: ReturnType<typeof setInterval> | undefined

  /** The pane's letters, taken only while it is up — a global layer; a targeted one never fires. */
  const takeKeys = () => {
    disposeKeys ??= api.keymap.registerLayer(layer())
  }
  const dropKeys = () => {
    disposeKeys?.()
    disposeKeys = undefined
  }

  const close = () => {
    if (!surface.open) return
    log.debug("close", { id: surface.open })
    surface.open = undefined
    surface.draft = undefined
    dropKeys()
    clearInterval(fast)
    fast = undefined
    painter.blur()
    draw()
  }

  const open = (id: string) => {
    if (!model.sessions.has(id)) return
    log.debug("open", { id, full: surface.full })
    const same = surface.open === id
    Object.assign(surface, {
      open: id,
      notice: undefined,
      stopping: undefined,
      draft: undefined,
      ...(same ? {} : { top: undefined, selected: undefined, details: false, keys: false }),
    })
    takeKeys()
    fast ??= setInterval(() => {
      const session = opened()
      if (session && busy(session)) {
        painter.tick()
        draw()
      }
    }, 150)
    /** As Shell's full screen does: focus leaves the prompt, so its cursor stops blinking through. */
    painter.focus()
    draw()
  }

  const step = (by: number) => {
    const list = nodes()
    const at = list.findIndex((node) => node.session.id === surface.open)
    const next = list[(at + by + list.length) % list.length]
    if (next) open(next.session.id)
  }

  const scroll = (by: number) => {
    const most = painter.shown()?.most ?? 0
    const top = Math.max(0, Math.min(most, (surface.top ?? most) + by))
    surface.top = top >= most ? undefined : top
    draw()
  }

  /** The cursor onto the next or previous item; the first press lands on the last one in view. */
  const select = (by: number) => {
    const list = painter.shown()?.keys ?? []
    if (list.length === 0) return
    const at = surface.selected ? list.indexOf(surface.selected) : -1
    const next = at < 0 ? list.length - 1 : Math.max(0, Math.min(list.length - 1, at + by))
    surface.selected = list[next]
    /** Pinned where it is, so the pane scrolls to the cursor rather than the run. */
    surface.top = painter.shown()?.top
    surface.reveal = true
    draw()
  }

  /** Opens the item, or folds it: whichever it is not now. */
  const toggle = (key: string | undefined = surface.selected) => {
    if (!key) return
    /** A `task` call that launched a subagent is a way into it — the same pane ←/→ would reach. */
    const child = painter.shown()?.links.get(key)
    if (child && model.sessions.has(child) && !isHidden(child)) {
      log.debug("follow task", { key, child })
      open(child)
      return
    }
    const isOpen = painter.shown()?.opened.includes(key) ?? false
    if (isOpen) {
      surface.opened.delete(key)
      surface.closed.add(key)
    } else {
      surface.closed.delete(key)
      surface.opened.add(key)
    }
    if (isOpen) surface.whole.delete(key)
    surface.selected = key
    surface.top = painter.shown()?.top
    /** Folding a long call you had scrolled into brings its first line back into view. */
    surface.reveal = true
    log.debug("toggle", { key, open: !isOpen })
    draw()
  }

  /** `a`: the selected call's whole output, or back to its first lines. */
  const showAll = () => {
    const key = surface.selected
    if (!key?.startsWith("tool:")) return
    const all = !surface.whole.has(key)
    if (all) {
      surface.whole.add(key)
      surface.closed.delete(key)
      surface.opened.add(key)
    } else surface.whole.delete(key)
    surface.top = painter.shown()?.top
    surface.reveal = !all
    log.debug("show all", { key, all })
    draw()
  }

  /** Every call open, or every one folded. */
  const expandAll = () => {
    const calls = (painter.shown()?.keys ?? []).filter((key) => key.startsWith("tool:"))
    const all = calls.length > 0 && calls.every((key) => painter.shown()?.opened.includes(key))
    surface.opened = all ? new Set() : new Set(calls)
    surface.closed = all ? new Set(calls) : new Set()
    draw()
  }

  const click = (y: number) => {
    const shown = painter.shown()
    if (!shown || surface.draft !== undefined) return
    const key = shown.items[y]
    if (key) toggle(key)
  }

  let confirmTimer: ReturnType<typeof setTimeout> | undefined

  /** Out of the list — the session itself stays in OpenCode, and comes back if it works again. */
  const remove = (ids: string[]) => {
    if (ids.length === 0) return
    for (const id of ids) {
      hidden.delete(id)
      hidden.add(id)
    }
    saveHidden()
    log.info("removed", { count: ids.length })
    if (surface.open && isHidden(surface.open)) {
      const next = nodes().at(-1)
      if (next) open(next.session.id)
      else close()
    }
    draw()
  }

  const finished = () =>
    nodes()
      .map((node) => node.session)
      .filter((session) => session.status === "done" || session.status === "failed")
      .map((session) => session.id)

  /** `x`: a working one stops — on a second `x`, since it cannot be undone; a finished one leaves the list. */
  const stopOrRemove = () => {
    const session = opened()
    if (!session) return
    if (!busy(session) && session.status !== "waiting") return remove([session.id])
    /**
     * Stopping is only for a run OpenCode says is going. One Cockpit had wrong — shown running after a
     * reopen — was "stopped", and the main agent was told about work that had long ended.
     */
    const said = feed.check(session.id)
    if (
      said.some(
        (change) => change.type === "status" && change.status !== "busy" && change.status !== "waiting",
      )
    ) {
      applyAll(model, said)
      log.info("stop skipped: not running", { id: session.id })
      return set({
        notice: `${session.agent} had already finished — nothing to stop. x again removes it.`,
        stopping: undefined,
      })
    }
    if (surface.stopping !== session.id) {
      surface.stopping = session.id
      surface.notice = `Press x again to stop ${session.agent}.`
      clearTimeout(confirmTimer)
      confirmTimer = setTimeout(() => {
        if (surface.stopping) set({ stopping: undefined, notice: undefined })
      }, CONFIRM_MS)
      return draw()
    }
    clearTimeout(confirmTimer)
    const { id, agent, title, parentID } = session
    surface.stopping = undefined
    surface.notice = `Stopping ${agent}…`
    draw()
    const parent = parentID ? model.sessions.get(parentID) : undefined
    /**
     * The main agent is told first, and why, so the stop reaches it with a reason. Measured on both:
     * told, it says the subagent was stopped and waits; untold, it read a failure and relaunched.
     */
    const note = parentID
      ? feed
          .note(
            parentID,
            `[Cockpit] I stopped the ${agent} subagent${title ? ` "${title}"` : ""} on purpose. Don't start it again unless I ask.`,
            parent ? busy(parent) || parent.status === "waiting" : true,
            parent && parent.agent !== "agent" ? parent.agent : undefined,
          )
          .catch((error: unknown) => log.warn("stop note failed", { parentID, error }))
      : Promise.resolve()
    note
      .then(() => feed.stop(id))
      .then(() => {
        log.info("stopped", { id, agent, told: Boolean(parentID) })
        surface.notice = `Stopped ${agent}. The main agent was told you stopped it.`
      })
      .catch((error) => {
        log.error("stop failed", { id, error })
        surface.notice = `Not stopped: ${error instanceof Error ? error.message : String(error)}`
      })
      .finally(draw)
  }

  /**
   * `b`: the conversation stops waiting for this subagent — OpenCode's `ctrl+b`, from here. It moves
   * every subagent that conversation is blocked on, which is what the host offers.
   */
  const toBackground = () => {
    const session = opened()
    if (!session?.parentID) return
    if (!busy(session)) return set({ notice: `${session.agent} is not running.` })
    if (session.background) return set({ notice: `${session.agent} already runs in the background.` })
    const { id, agent, parentID } = session
    surface.notice = `Moving ${agent} to the background…`
    draw()
    feed
      .background(parentID)
      .then((moved) => {
        log.info("background", { id, parentID, moved })
        if (moved) applyAll(model, [{ type: "session", id, background: true, at: Date.now() }])
        surface.notice = moved
          ? `${agent} runs in the background; the main agent carries on and hears when it finishes.`
          : "OpenCode 1 does this only when started with OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true."
      })
      .catch((error) => {
        log.error("background failed", { id, error })
        surface.notice = `Not moved: ${error instanceof Error ? error.message : String(error)}`
      })
      .finally(draw)
  }

  const clearFinished = () => {
    const ids = finished()
    remove(ids)
    if (ids.length === 0)
      api.ui.toast({ variant: "info", title: "Subagents", message: "No finished subagents to clear." })
  }

  const restore = () => {
    const count = hidden.size
    hidden.clear()
    saveHidden()
    log.info("restored", { count })
    api.ui.toast({
      variant: "info",
      title: "Subagents",
      message: count
        ? `${count} removed subagent${count === 1 ? "" : "s"} back in the list.`
        : "None removed.",
    })
    draw()
  }

  const width = () => {
    surface.full = !surface.full
    api.kv.set(FULL_KEY, surface.full)
    log.debug("width", { full: surface.full })
    draw()
  }

  const layer = (): Layer => ({
    priority: 100,
    commands: [
      { name: "cockpit.subagents.next", title: "Next subagent", run: () => step(1) },
      { name: "cockpit.subagents.prev", title: "Previous subagent", run: () => step(-1) },
      {
        name: "cockpit.subagents.message",
        title: "Message this subagent",
        run: () => messages.startMessage(),
      },
      { name: "cockpit.subagents.stop", title: "Stop, or remove from the list", run: () => stopOrRemove() },
      {
        name: "cockpit.subagents.clear",
        title: "Remove every finished subagent",
        run: () => clearFinished(),
      },
      { name: "cockpit.subagents.background", title: "Move to the background", run: () => toBackground() },
      { name: "cockpit.subagents.all", title: "Show a call's whole output", run: () => showAll() },
      { name: "cockpit.subagents.down", title: "Next item", run: () => select(1) },
      { name: "cockpit.subagents.up", title: "Previous item", run: () => select(-1) },
      { name: "cockpit.subagents.toggle", title: "Open or fold", run: () => toggle() },
      { name: "cockpit.subagents.expand", title: "Open every call", run: () => expandAll() },
      {
        name: "cockpit.subagents.thinking",
        title: "Show or hide thinking",
        run: () => {
          api.kv.set(THINKING_KEY, !surface.thinking)
          /** A block folded or opened by hand follows the new choice. */
          surface.opened.clear()
          surface.closed.clear()
          set({ thinking: !surface.thinking })
        },
      },
      {
        name: "cockpit.subagents.details",
        title: "Details",
        run: () => set({ details: !surface.details, top: undefined }),
      },
      { name: "cockpit.subagents.width", title: "Half or full width", run: () => width() },
      {
        name: "cockpit.subagents.keys",
        title: "Show every key",
        /** From the top of the list going in; back where the run was coming out. */
        run: () => set({ keys: !surface.keys, top: surface.keys ? undefined : 0 }),
      },
      { name: "cockpit.subagents.pageDown", title: "Scroll down", run: () => scroll(10) },
      { name: "cockpit.subagents.pageUp", title: "Scroll up", run: () => scroll(-10) },
      {
        name: "cockpit.subagents.follow",
        title: "Follow the run",
        run: () => set({ top: undefined, selected: undefined }),
      },
      { name: "cockpit.subagents.top", title: "Scroll to the start", run: () => set({ top: 0 }) },
      {
        name: "cockpit.subagents.close",
        title: "Close",
        /** Esc first hides the keys, then lets go of the cursor, then closes. */
        run: () =>
          surface.keys
            ? set({ keys: false, top: undefined })
            : surface.selected
              ? set({ selected: undefined, top: undefined })
              : close(),
      },
    ],
    bindings: [
      { key: "],right", cmd: "cockpit.subagents.next" },
      { key: "[,left", cmd: "cockpit.subagents.prev" },
      { key: "m", cmd: "cockpit.subagents.message" },
      { key: "x", cmd: "cockpit.subagents.stop" },
      { key: "shift+x", cmd: "cockpit.subagents.clear" },
      { key: "b", cmd: "cockpit.subagents.background" },
      { key: "a", cmd: "cockpit.subagents.all" },
      { key: "j,down", cmd: "cockpit.subagents.down" },
      { key: "k,up", cmd: "cockpit.subagents.up" },
      { key: "return,space", cmd: "cockpit.subagents.toggle" },
      { key: "e", cmd: "cockpit.subagents.expand" },
      { key: "t", cmd: "cockpit.subagents.thinking" },
      { key: "i", cmd: "cockpit.subagents.details" },
      { key: "w", cmd: "cockpit.subagents.width" },
      { key: "?,shift+/", cmd: "cockpit.subagents.keys" },
      { key: "d,pagedown", cmd: "cockpit.subagents.pageDown" },
      { key: "u,pageup", cmd: "cockpit.subagents.pageUp" },
      { key: "shift+g,end", cmd: "cockpit.subagents.follow" },
      { key: "g,home", cmd: "cockpit.subagents.top" },
      { key: "q,escape", cmd: "cockpit.subagents.close" },
    ],
  })

  /** From anywhere: the working subagent, or the latest one, of the conversation on screen. */
  const openLatest = () => {
    follow()
    const list = nodes()
    const pick =
      list.find(({ session }) => session.status === "running" || session.status === "waiting") ?? list.at(-1)
    if (pick) open(pick.session.id)
    else
      api.ui.toast({
        variant: "info",
        title: "Subagents",
        message: "No subagents in this conversation yet.",
      })
  }

  return {
    open,
    close,
    scroll,
    click,
    openLatest,
    clearFinished,
    restore,
    dispose: () => {
      clearInterval(fast)
      clearTimeout(confirmTimer)
      fast = undefined
      dropKeys()
    },
  }
}
