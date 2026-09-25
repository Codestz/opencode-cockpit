/** @jsxImportSource @opentui/solid */

import { claimFeature, duplicateFeatureMessage } from "@opencode-cockpit/client/feature"
import { bindingLookup, dualTui, type Host, type Layer, onPaste } from "@opencode-cockpit/client/host"
import { sidebarOrder } from "@opencode-cockpit/client/sidebar"
import type { BoxRenderable } from "@opentui/core"
import { createSignal } from "solid-js"
import type { Change } from "../core/model/changes.ts"
import { applyAll, emptyModel, type Node, rootOf, type Session, subagentsOf } from "../core/model/model.ts"
import { createScreenCache, type Screen, screenRows } from "../core/view/screen.ts"
import { type SidebarLine, sidebarLines } from "../core/view/sidebar.ts"
import { createRowPool, type RowPool, solidSurface } from "./render.ts"
import { createSource } from "./source.ts"
import { Overlay } from "./view/overlay.tsx"
import { SidebarBlock } from "./view/sidebar.tsx"

const SUBAGENTS_PACKAGE = "@opencode-cockpit/subagents"

const DEFAULT_KEYS = {
  "cockpit.subagents.open": "<leader>w",
}

export interface SubagentsTuiOptions {
  /** Subagents shown in the sidebar before the rest fold into a count. */
  sidebarRows?: number
  /**
   * Minutes a finished subagent stays in the sidebar; unset keeps it for the conversation. It is only
   * out of the sidebar — `/subagents` and the pane's `[` `]` still reach it, and it comes back if it
   * works again.
   */
  hideFinishedAfter?: number
  /** Where the block sits among sidebar blocks; lower draws first (Shell 150, statusline 200). */
  sidebarOrder?: number
  keybinds?: Record<string, string>
}

/** The pane's state: which subagent, and how it is being looked at. */
interface Surface {
  open?: string
  /** First body row shown; undefined follows the run. */
  top?: number
  selected?: string
  /** Items opened, or folded, by hand. */
  opened: Set<string>
  closed: Set<string>
  thinking: boolean
  details: boolean
  /** Half the window, or all of it. Remembered. */
  full: boolean
  /** A message being typed, at the foot of the pane. */
  draft?: string
  notice?: string
  /** Calls shown whole rather than their first lines. */
  whole: Set<string>
  /** The cursor just moved: the next paint brings it into view, and only that one. */
  reveal?: boolean
  /** The subagent a first `x` asked to stop; a second `x` in time stops it. */
  stopping?: string
}

const FULL_KEY = "cockpit.subagents.full"
/** Messages you sent, as `<session>:<text>` — so the pane can tell yours from the main agent's. */
const YOURS_KEY = "cockpit.subagents.yours"
const YOURS_MAX = 200
/** How much of an answer is relayed to the main agent. */
const RELAY_MAX = 4000
const clip = (text: string, most: number) => (text.length > most ? `${text.slice(0, most - 1)}…` : text)
/** Thinking shown or folded — shown until you say otherwise, then as you left it. */
const THINKING_KEY = "cockpit.subagents.thinking"
/** Subagents removed from the list, by id — kept across restarts, the newest few hundred. */
const HIDDEN_KEY = "cockpit.subagents.hidden"
const HIDDEN_MAX = 300
/** How long a run may say nothing before the host is asked whether it is still going. */
const QUIET_MS = 20_000
/** How long the second `x` that confirms a stop is waited for. */
const CONFIRM_MS = 4_000

/** Subagents' TUI half as a factory, so the `opencode-cockpit` bundle can include it. */
export function createSubagentsTui({ source = SUBAGENTS_PACKAGE }: { source?: string } = {}) {
  return async (api: Host, rawOptions?: unknown) => {
    const log = api.log.child("subagents")
    const claim = claimFeature(api.renderer, "subagents", source)
    if (!claim.active) {
      log.warn("configured twice", { owner: claim.owner, skipped: source })
      api.ui.toast({
        variant: "warning",
        title: "Subagents",
        message: duplicateFeatureMessage("Subagents", claim.owner, source),
      })
      return
    }
    api.lifecycle.onDispose(() => claim.release())
    const options = (rawOptions ?? {}) as SubagentsTuiOptions
    const keys = bindingLookup({ ...DEFAULT_KEYS, ...options.keybinds })

    const model = emptyModel()
    const yours = new Set<string>(api.kv.get<string[]>(YOURS_KEY, []))
    const surface: Surface = {
      opened: new Set(),
      closed: new Set(),
      whole: new Set(),
      thinking: api.kv.get(THINKING_KEY, true),
      details: false,
      full: api.kv.get(FULL_KEY, false),
    }
    let frame = 0
    let root: string | undefined
    let backdrop: BoxRenderable | undefined
    let panel: BoxRenderable | undefined
    let pool: RowPool | undefined
    let shown: Screen | undefined
    /** Each item's rows between paints: a scroll or a tick redraws only what changed. */
    const cache = createScreenCache()
    let disposeKeys: (() => void) | undefined
    const [lines, setLines] = createSignal<readonly SidebarLine[]>([])

    /** The conversation on screen — or the one a subagent you are looking at belongs to. */
    const current = (): string | undefined => {
      const route = api.route.current
      const id = route.name === "session" ? (route.params?.sessionID as string | undefined) : undefined
      return id ? rootOf(model, id) : undefined
    }
    const hidden = new Set<string>(api.kv.get<string[]>(HIDDEN_KEY, []))
    const saveHidden = () => api.kv.set(HIDDEN_KEY, [...hidden].slice(-HIDDEN_MAX))
    /** Removed, or under one that was: a removed subagent takes the ones it launched with it. */
    const isHidden = (id: string): boolean => {
      for (let at: string | undefined = id, n = 0; at && n < 8; at = model.sessions.get(at)?.parentID, n++)
        if (hidden.has(at)) return true
      return false
    }
    const nodes = (): Node[] =>
      root ? subagentsOf(model, root).filter((node) => !isHidden(node.session.id)) : []
    const opened = (): Session | undefined => (surface.open ? model.sessions.get(surface.open) : undefined)
    let block: BoxRenderable | undefined
    let drawnAt = 0
    let sidebarSaid = ""
    /**
     * The width the sidebar gave the block, once laid out; a guess before that. Guessed, the rows ran
     * past the edge and were clipped: "3 done" drew as "3 d".
     */
    let told = 0
    const sidebarWidth = () => {
      /**
       * The container the host gave the block, not the block: rows wider than the sidebar stretch the
       * block with them, so its own width only ever agreed with the guess.
       */
      const parent = (block?.parent as { width?: number } | null | undefined)?.width ?? 0
      const own = block?.width ?? 0
      const measured = parent >= 12 ? Math.min(parent, own >= 12 ? own : parent) : own
      if (measured !== told) {
        told = measured
        log.debug("sidebar width", { measured, own, parent, window: api.renderer.width })
      }
      return measured >= 12 ? measured : Math.max(20, Math.min(40, Math.floor(api.renderer.width / 4) - 2))
    }
    const busy = (session: Session) => session.status === "running" || session.status === "starting"
    const working = () => nodes().some(({ session }) => busy(session) || session.status === "waiting")
    /** Half the window, but never so narrow a call's arguments cannot be read. */
    const paneWidth = () => {
      const width = api.renderer.width
      return surface.full ? width : Math.min(width, Math.max(72, Math.floor(width / 2)))
    }

    // --- painting ----------------------------------------------------------------------------------

    const paint = () => {
      const now = Date.now()
      const list = nodes()
      drawnAt = sidebarWidth()
      const after = options.hideFinishedAfter
      const listed =
        typeof after === "number" && after >= 0
          ? list.filter(
              ({ session }) =>
                !(session.status === "done" || session.status === "failed") ||
                now - (session.ended ?? now) < after * 60_000,
            )
          : list
      const next = sidebarLines({
        nodes: listed,
        width: drawnAt,
        now,
        frame,
        limit: options.sidebarRows ?? 6,
      })
      /** Only when they changed: new rows rebuild every line of the block, and a scroll is many paints. */
      const said = JSON.stringify(next)
      if (said !== sidebarSaid) {
        sidebarSaid = said
        setLines(next)
      }
      const session = opened()
      if (backdrop && panel && pool) {
        const show = Boolean(session)
        const height = api.renderer.height
        backdrop.width = api.renderer.width
        backdrop.height = show ? height : 0
        backdrop.visible = show
        panel.backgroundColor = solidSurface(api.theme.current)
        panel.width = paneWidth()
        panel.height = show ? height : 0
        if (session && show) {
          const launcher = session.parentID ? model.sessions.get(session.parentID)?.agent : undefined
          const started = performance.now()
          const screen = screenRows({
            cache,
            session,
            nodes: list,
            ...(launcher ? { launcher } : {}),
            width: paneWidth(),
            height,
            now,
            frame,
            ...(surface.top !== undefined ? { top: surface.top } : {}),
            ...(surface.selected ? { selected: surface.selected } : {}),
            open: surface.opened,
            closed: surface.closed,
            thinking: surface.thinking,
            details: surface.details,
            whole: surface.whole,
            yours: (entry) => yours.has(`${session.id}:${entry.text}`),
            reveal: surface.reveal === true,
            ...(surface.draft !== undefined ? { input: { draft: surface.draft, busy: busy(session) } } : {}),
            ...(surface.notice ? { notice: surface.notice } : {}),
          })
          /** Scrolled back to the end: follow the run again. */
          /** Where the reveal left the view is where it stays. */
          if (surface.reveal && surface.top !== undefined) surface.top = screen.top
          surface.reveal = false
          if (surface.top !== undefined && screen.top >= screen.most && !surface.selected)
            surface.top = undefined
          shown = screen
          pool.draw(screen.rows, api.theme.current)
          const took = performance.now() - started
          /** A paint past a frame is worth knowing about; the run's size says why. */
          if (took > 16) log.debug("slow paint", { ms: Math.round(took), entries: session.entries.length })
          /** The prompt's cursor would otherwise blink through the pane, as it did over Review. */
          setTimeout(() => {
            if (surface.open) api.renderer.setCursorPosition(0, 0, false)
          }, 0)
        } else {
          shown = undefined
          pool.clear()
        }
      }
      api.renderer.requestRender()
    }
    /** Several asks in one turn are one paint, of the state the turn ended on (Shell's painter). */
    let scheduled = false
    const draw = () => {
      if (scheduled) return
      scheduled = true
      setTimeout(() => {
        scheduled = false
        try {
          paint()
        } catch (error) {
          log.error("paint failed", { error })
        }
      }, 0)
    }

    // --- data --------------------------------------------------------------------------------------

    const feed = createSource(api, log, (changes: Change[]) => {
      if (changes.length === 0) return
      applyAll(model, changes)
      for (const change of changes) {
        if (change.type === "status" && change.status !== "busy" && change.status !== "waiting")
          relay(change.id)
        if (change.type === "session" && change.parentID)
          log.debug("subagent", { id: change.id, parent: change.parentID, agent: change.agent })
        /** Removed, then started again (the main agent continued it): it belongs in the list again. */
        if (change.type === "status" && change.status === "busy" && hidden.delete(change.id)) {
          log.debug("unhidden: working again", { id: change.id })
          saveHidden()
        }
      }
      draw()
    })

    /** A conversation came on screen: load the subagents it already has. */
    const follow = () => {
      const next = current()
      if (next === root) return
      root = next
      if (!next) return draw()
      log.debug("conversation", { root: next })
      feed
        .load(next)
        .then(draw)
        .catch((error) => log.warn("load failed", { root: next, error }))
    }

    /**
     * A run that has gone quiet is asked about. An end the events never told us of — a missed event,
     * a stop from elsewhere — otherwise left a subagent "running" until OpenCode restarted.
     */
    const reconcile = () => {
      const now = Date.now()
      for (const { session } of nodes()) {
        if (session.status !== "running" && session.status !== "starting") continue
        if (now - session.seen < QUIET_MS) continue
        const changes = feed.check(session.id)
        const said = changes[0]
        if (said?.type === "status" && said.status !== "busy") {
          log.info("quiet run ended", { id: session.id, status: said.status })
          applyAll(model, changes)
          draw()
        } else session.seen = now
      }
    }

    /** The clock: once a second for the sidebar's times, faster while a subagent is open and working. */
    let slow: ReturnType<typeof setInterval> | undefined = setInterval(() => {
      follow()
      reconcile()
      /** The sidebar was laid out, or resized, since the rows were drawn. */
      if (sidebarWidth() !== drawnAt) draw()
      if (working()) {
        frame++
        draw()
      } else if (options.hideFinishedAfter !== undefined) draw() // finished ones age out with nothing running
    }, 1000)
    let fast: ReturnType<typeof setInterval> | undefined

    // --- the pane ----------------------------------------------------------------------------------

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
      backdrop?.blur()
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
        ...(same ? {} : { top: undefined, selected: undefined, details: false }),
      })
      takeKeys()
      fast ??= setInterval(() => {
        const session = opened()
        if (session && busy(session)) {
          frame++
          draw()
        }
      }, 150)
      /** As Shell's full screen does: focus leaves the prompt, so its cursor stops blinking through. */
      backdrop?.focus()
      draw()
    }

    const step = (by: number) => {
      const list = nodes()
      const at = list.findIndex((node) => node.session.id === surface.open)
      const next = list[(at + by + list.length) % list.length]
      if (next) open(next.session.id)
    }

    const scroll = (by: number) => {
      const most = shown?.most ?? 0
      const top = Math.max(0, Math.min(most, (surface.top ?? most) + by))
      surface.top = top >= most ? undefined : top
      draw()
    }

    /** The cursor onto the next or previous item; the first press lands on the last one in view. */
    const select = (by: number) => {
      const list = shown?.keys ?? []
      if (list.length === 0) return
      const at = surface.selected ? list.indexOf(surface.selected) : -1
      const next = at < 0 ? list.length - 1 : Math.max(0, Math.min(list.length - 1, at + by))
      surface.selected = list[next]
      /** Pinned where it is, so the pane scrolls to the cursor rather than the run. */
      surface.top = shown?.top
      surface.reveal = true
      draw()
    }

    /** Opens the item, or folds it: whichever it is not now. */
    const toggle = (key: string | undefined = surface.selected) => {
      if (!key) return
      const isOpen = shown?.opened.includes(key) ?? false
      if (isOpen) {
        surface.opened.delete(key)
        surface.closed.add(key)
      } else {
        surface.closed.delete(key)
        surface.opened.add(key)
      }
      if (isOpen) surface.whole.delete(key)
      surface.selected = key
      surface.top = shown?.top
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
      surface.top = shown?.top
      surface.reveal = !all
      log.debug("show all", { key, all })
      draw()
    }

    /** Every call open, or every one folded. */
    const expandAll = () => {
      const calls = (shown?.keys ?? []).filter((key) => key.startsWith("tool:"))
      const all = calls.length > 0 && calls.every((key) => shown?.opened.includes(key))
      surface.opened = all ? new Set() : new Set(calls)
      surface.closed = all ? new Set(calls) : new Set()
      draw()
    }

    const click = (y: number) => {
      if (!shown || surface.draft !== undefined) return
      const key = shown.items[y]
      if (key) toggle(key)
    }

    const startMessage = () => {
      if (!opened()) return
      surface.draft = ""
      surface.notice = undefined
      log.debug("message: typing", { id: surface.open })
      draw()
    }

    /**
     * Messages you sent a finished subagent, until it answers. Its answer goes nowhere on its own — the
     * main agent's task returned long ago — so once it is idle again, what you asked and what it said
     * are added to the main conversation, quietly: no turn starts, and the main agent knows next time.
     */
    const asked = new Map<string, { question: string; busy: boolean }>()
    /** How long a subagent that went idle is given to start a run of its own for a queued message. */
    const SETTLE_MS = 3000

    /** The entries after your message: what the subagent did with it, if anything. */
    const after = (id: string, question: string) => {
      const entries = model.sessions.get(id)?.entries ?? []
      const at = entries.findLastIndex((entry) => entry.kind === "prompt" && entry.text === question)
      return at < 0 ? [] : entries.slice(at + 1)
    }

    const relay = (id: string) => {
      if (!asked.has(id)) return
      /**
       * Settled first: sent while it was busy, OpenCode 1 may queue the message and start a run for it
       * straight after — or finish without reading it at all, which happened: the message sat in the
       * run as "Round 3" and nothing answered it.
       */
      setTimeout(() => {
        const pending = asked.get(id)
        const session = model.sessions.get(id)
        if (!pending || !session) return
        if (busy(session) || session.status === "waiting") {
          /** A run of its own for the message: its answer goes nowhere unless it is relayed. */
          pending.busy = false
          return
        }
        asked.delete(id)
        const followed = after(id, pending.question)
        if (!followed.some((entry) => entry.kind !== "prompt")) {
          log.warn("message not answered", { id })
          if (surface.open === id && surface.draft === undefined)
            set({
              draft: pending.question,
              notice: `${session.agent} finished without reading your message — enter sends it again, esc drops it.`,
            })
          return
        }
        /** Read inside a run the main agent was waiting on: its answer already went there. */
        if (pending.busy || !session.parentID) return
        const answer = followed
          .filter((entry): entry is Extract<typeof entry, { kind: "reply" }> => entry.kind === "reply")
          .map((entry) => entry.text.trim())
          .filter(Boolean)
          .join("\n\n")
        const parent = model.sessions.get(session.parentID)
        const how = api.v1 ? "task_id" : "sessionID"
        const text = [
          "[Cockpit notification — information, not a request. Nothing to do unless the user asks.]",
          `The user messaged your ${session.agent} subagent "${session.title}" (${how} ${id}) directly.`,
          `They asked: ${pending.question}`,
          session.status === "failed"
            ? `It failed: ${session.error ?? "no reason given"}`
            : `It answered: ${answer ? clip(answer, RELAY_MAX) : "(nothing)"}`,
        ].join("\n")
        feed
          .quiet(session.parentID, text, parent && parent.agent !== "agent" ? parent.agent : undefined)
          .then(() => {
            log.info("relayed to the main agent", { id, parent: session.parentID })
            if (surface.open === id)
              set({ notice: `The main agent now knows what ${session.agent} answered you.` })
          })
          .catch((error) => log.warn("relay failed", { id, error }))
      }, SETTLE_MS)
    }

    const sendMessage = () => {
      const session = opened()
      const text = surface.draft?.trim()
      surface.draft = undefined
      if (!session || !text) return draw()
      /** Taken now: the model may learn something about the session before the call returns. */
      const { id, agent } = session
      const wasBusy = busy(session)
      yours.add(`${id}:${text}`)
      api.kv.set(YOURS_KEY, [...yours].slice(-YOURS_MAX))
      /** Working, it answers the main agent itself; finished, its answer is relayed once it comes. */
      /** Watched either way: answered in a run of its own, it is relayed; not answered, it comes back. */
      asked.set(id, { question: text, busy: wasBusy })
      surface.notice = `Sending to ${agent}…`
      surface.top = undefined
      draw()
      feed
        .send(id, text, wasBusy, agent)
        .then(() => {
          log.info("message sent", { id, agent, busy: wasBusy })
          surface.notice = `Sent to ${agent}.`
        })
        .catch((error) => {
          log.error("message failed", { id, error })
          surface.notice = `Not sent: ${error instanceof Error ? error.message : String(error)}`
        })
        .finally(draw)
    }

    /** A paste while typing goes into the message — one line, as the field is. */
    const offPaste = onPaste(api, (text) => {
      if (!surface.open || surface.draft === undefined) return false
      surface.draft += text.replace(/\r?\n/g, " ")
      log.debug("message: pasted", { chars: text.length })
      draw()
      return true
    })
    api.lifecycle.onDispose(offPaste)

    /** Typing a message takes every key before the layer, so `e`, `t`, `j`… go into the words. */
    api.keymap.intercept(
      (ctx) => {
        if (!surface.open || surface.draft === undefined) return
        const event = ctx.event
        ctx.consume({ preventDefault: true, stopPropagation: true })
        if (event.name === "escape") {
          surface.draft = undefined
          return draw()
        }
        if (event.name === "return" || event.name === "enter") return sendMessage()
        if (event.name === "backspace") surface.draft = surface.draft.slice(0, -1)
        else if (event.sequence && !event.ctrl && !event.meta && event.sequence >= " ")
          surface.draft += event.sequence
        draw()
      },
      { priority: 10_000 },
    )

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

    const set = (change: Partial<Surface>) => {
      Object.assign(surface, change)
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
        { name: "cockpit.subagents.message", title: "Message this subagent", run: () => startMessage() },
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
          /** Esc first lets go of the cursor, then closes. */
          run: () => (surface.selected ? set({ selected: undefined, top: undefined }) : close()),
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
        list.find(({ session }) => session.status === "running" || session.status === "waiting") ??
        list.at(-1)
      if (pick) open(pick.session.id)
      else
        api.ui.toast({
          variant: "info",
          title: "Subagents",
          message: "No subagents in this conversation yet.",
        })
    }

    api.keymap.registerLayer({
      commands: [
        {
          name: "cockpit.subagents.open",
          title: "Open subagents",
          category: "Subagents",
          namespace: "palette",
          slashName: "subagents",
          run: () => openLatest(),
        },
        {
          name: "cockpit.subagents.clearFinished",
          title: "Clear finished subagents",
          category: "Subagents",
          namespace: "palette",
          run: () => clearFinished(),
        },
        {
          name: "cockpit.subagents.restore",
          title: "Show removed subagents again",
          category: "Subagents",
          namespace: "palette",
          run: () => restore(),
        },
      ],
      bindings: keys.gather("cockpit", Object.keys(DEFAULT_KEYS)),
    })

    api.slots.register({
      /** Between the statusline (140) and the shells (170) by default; lower draws first. */
      order: sidebarOrder("subagents", 150, options.sidebarOrder, { directory: api.state.path.directory }),
      slots: {
        sidebar_content: () => (
          <SidebarBlock
            api={api}
            lines={lines}
            onOpen={open}
            onReady={(box) => {
              block = box
            }}
          />
        ),
      },
    })
    api.slots.register({
      order: 160,
      slots: {
        app_bottom: () => (
          <Overlay
            api={api}
            onReady={(parts) => {
              backdrop = parts.backdrop
              panel = parts.panel
              pool = createRowPool(parts.lines)
              draw()
            }}
            /** Clicking off the pane closes it; at full width there is no "off" to click. */
            onDismiss={() => {
              if (!surface.full) close()
            }}
            onClick={(y) => click(y)}
            onScroll={(delta) => scroll(delta)}
          />
        ),
      },
    })

    follow()
    api.lifecycle.onDispose(() => {
      clearInterval(slow)
      clearInterval(fast)
      clearTimeout(confirmTimer)
      slow = undefined
      fast = undefined
      dropKeys()
      feed.dispose()
    })
  }
}

/** One entry for both OpenCodes: v1 calls `tui`, v2 calls `setup` (docs/opencode/v2.md). */
export default dualTui("opencode-cockpit.subagents", createSubagentsTui())
