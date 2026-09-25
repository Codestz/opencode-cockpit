/** @jsxImportSource @opentui/solid */

import { claimFeature, duplicateFeatureMessage } from "@opencode-cockpit/client/feature"
import { bindingLookup, dualTui, type Host, type Layer } from "@opencode-cockpit/client/host"
import type { BoxRenderable } from "@opentui/core"
import { createSignal } from "solid-js"
import type { Change } from "../core/model/changes.ts"
import { applyAll, emptyModel, type Node, rootOf, type Session, subagentsOf } from "../core/model/model.ts"
import { screenRows } from "../core/view/screen.ts"
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
  /** Where the block sits among sidebar blocks; lower draws first (Shell 150, statusline 200). */
  sidebarOrder?: number
  keybinds?: Record<string, string>
}

/** The full screen's state: which subagent, and how it is being looked at. */
interface Surface {
  open?: string
  up: number
  thinking: boolean
  expanded: boolean
  notice?: string
  /**
   * A dialog is open over the screen. The screen steps aside while it is: it covers the whole window
   * at the top of the stack, and OpenCode 1 draws its dialog underneath it — typing went into a
   * dialog nobody could see.
   */
  asking?: boolean
}

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
    const surface: Surface = { up: 0, thinking: true, expanded: false }
    let frame = 0
    let root: string | undefined
    let backdrop: BoxRenderable | undefined
    let pool: RowPool | undefined
    let disposeKeys: (() => void) | undefined
    const [lines, setLines] = createSignal<readonly SidebarLine[]>([])

    /** The conversation on screen — or the one a subagent you are looking at belongs to. */
    const current = (): string | undefined => {
      const route = api.route.current
      const id = route.name === "session" ? (route.params?.sessionID as string | undefined) : undefined
      return id ? rootOf(model, id) : undefined
    }
    const nodes = (): Node[] => (root ? subagentsOf(model, root) : [])
    const opened = (): Session | undefined => (surface.open ? model.sessions.get(surface.open) : undefined)
    const sidebarWidth = () => Math.max(20, Math.min(40, Math.floor(api.renderer.width / 4) - 2))
    const working = () =>
      nodes().some(
        ({ session }) =>
          session.status === "running" || session.status === "starting" || session.status === "waiting",
      )

    // --- painting ----------------------------------------------------------------------------------

    const paint = () => {
      const now = Date.now()
      const list = nodes()
      setLines(
        sidebarLines({ nodes: list, width: sidebarWidth(), now, frame, limit: options.sidebarRows ?? 6 }),
      )
      const session = opened()
      if (backdrop && pool) {
        const show = Boolean(session) && !surface.asking
        backdrop.backgroundColor = solidSurface(api.theme.current)
        backdrop.width = api.renderer.width
        backdrop.height = show ? api.renderer.height : 0
        backdrop.visible = show
        if (session && show) {
          const launcher = session.parentID ? model.sessions.get(session.parentID)?.agent : undefined
          const screen = screenRows({
            session,
            nodes: list,
            ...(launcher ? { launcher } : {}),
            width: api.renderer.width,
            height: api.renderer.height,
            now,
            frame,
            up: surface.up,
            thinking: surface.thinking,
            expanded: surface.expanded,
            ...(surface.notice ? { notice: surface.notice } : {}),
          })
          surface.up = Math.min(surface.up, screen.most)
          pool.draw(screen.rows, api.theme.current)
          /** The prompt's cursor would otherwise blink through the screen, as it did over Review. */
          setTimeout(() => {
            if (surface.open) api.renderer.setCursorPosition(0, 0, false)
          }, 0)
        } else pool.clear()
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
      for (const change of changes)
        if (change.type === "session" && change.parentID)
          log.debug("subagent", { id: change.id, parent: change.parentID, agent: change.agent })
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

    /** The clock: once a second for the sidebar's times, faster while a subagent is open and working. */
    let slow: ReturnType<typeof setInterval> | undefined = setInterval(() => {
      follow()
      if (working()) {
        frame++
        draw()
      }
    }, 1000)
    let fast: ReturnType<typeof setInterval> | undefined

    // --- the full screen ---------------------------------------------------------------------------

    /**
     * The screen's letters, taken only while it is up — and given back while a dialog is open over
     * it, or the message you type fires `e`, `l`, `t`… underneath (Review's takeKeys/dropKeys).
     */
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
      dropKeys()
      clearInterval(fast)
      fast = undefined
      backdrop?.blur()
      draw()
    }

    const open = (id: string) => {
      if (!model.sessions.has(id)) return
      log.debug("open", { id })
      Object.assign(surface, { open: id, up: 0, expanded: false, notice: undefined })
      takeKeys()
      fast ??= setInterval(() => {
        if (opened()?.status === "running") {
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
      surface.up = Math.max(0, surface.up - by)
      draw()
    }

    const message = () => {
      const session = opened()
      if (!session) return
      const busy = session.status === "running" || session.status === "starting"
      /** Taken now: the model may learn something about the session while the dialog is open. */
      const { id, agent } = session
      /** The dialog gets the keys, the focus and the window; the screen takes them back after. */
      dropKeys()
      backdrop?.blur()
      surface.asking = true
      draw()
      void api.ui
        .prompt({
          title: `Message ${session.agent}`,
          description: busy
            ? "It picks this up in its current run."
            : "It has finished: it will answer, but the main agent is not told.",
          placeholder: "What should it do?",
        })
        .then(async (text) => {
          const said = text?.trim()
          if (!said) return
          await feed.send(id, said, busy, agent)
          log.info("message sent", { id, agent, busy })
          surface.notice = `Sent to ${agent}.`
          surface.up = 0
        })
        .catch((error) => {
          log.error("message failed", { id, error })
          surface.notice = `Not sent: ${error instanceof Error ? error.message : String(error)}`
        })
        .finally(() => {
          surface.asking = false
          if (surface.open) {
            takeKeys()
            backdrop?.focus()
          }
          draw()
        })
    }

    const set = (change: Partial<Surface>) => {
      Object.assign(surface, change)
      draw()
    }

    /** A global layer, only while the screen is up: a targeted one never fires here (gotchas.md). */
    const layer = (): Layer => ({
      priority: 100,
      commands: [
        { name: "cockpit.subagents.next", title: "Next subagent", run: () => step(1) },
        { name: "cockpit.subagents.prev", title: "Previous subagent", run: () => step(-1) },
        { name: "cockpit.subagents.message", title: "Message this subagent", run: () => message() },
        {
          name: "cockpit.subagents.thinking",
          title: "Show or hide thinking",
          run: () => set({ thinking: !surface.thinking }),
        },
        {
          name: "cockpit.subagents.expand",
          title: "Show every call",
          run: () => set({ expanded: !surface.expanded }),
        },
        { name: "cockpit.subagents.down", title: "Scroll down", run: () => scroll(3) },
        { name: "cockpit.subagents.up", title: "Scroll up", run: () => scroll(-3) },
        { name: "cockpit.subagents.follow", title: "Follow the run", run: () => set({ up: 0 }) },
        {
          name: "cockpit.subagents.top",
          title: "Scroll to the start",
          run: () => set({ up: Number.MAX_SAFE_INTEGER }),
        },
        { name: "cockpit.subagents.close", title: "Close", run: () => close() },
      ],
      bindings: [
        { key: "],l,right", cmd: "cockpit.subagents.next" },
        { key: "[,h,left", cmd: "cockpit.subagents.prev" },
        { key: "m", cmd: "cockpit.subagents.message" },
        { key: "t", cmd: "cockpit.subagents.thinking" },
        { key: "e", cmd: "cockpit.subagents.expand" },
        { key: "j,down", cmd: "cockpit.subagents.down" },
        { key: "k,up", cmd: "cockpit.subagents.up" },
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
      ],
      bindings: keys.gather("cockpit", Object.keys(DEFAULT_KEYS)),
    })

    api.slots.register({
      /** Under Shell's block (150), above the statusline (200). */
      order: options.sidebarOrder ?? 160,
      slots: {
        sidebar_content: () => <SidebarBlock api={api} lines={lines} onOpen={open} />,
        app_bottom: () => (
          <Overlay
            api={api}
            onReady={(parts) => {
              backdrop = parts.backdrop
              pool = createRowPool(parts.lines)
              draw()
            }}
            onScroll={(delta) => scroll(delta)}
          />
        ),
      },
    })

    follow()
    api.lifecycle.onDispose(() => {
      clearInterval(slow)
      clearInterval(fast)
      slow = undefined
      fast = undefined
      dropKeys()
      feed.dispose()
    })
  }
}

/** One entry for both OpenCodes: v1 calls `tui`, v2 calls `setup` (docs/opencode/v2.md). */
export default dualTui("opencode-cockpit.subagents", createSubagentsTui())
