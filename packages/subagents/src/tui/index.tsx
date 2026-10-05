/** @jsxImportSource @opentui/solid */

/**
 * Subagents' interface half: the sidebar block — the subagents this conversation launched, live —
 * and the pane that opens one of them.
 *
 * Everything that decides is in `core/`; this file wires it to the host: the conversation on screen
 * followed, its subagents loaded and kept current, the painter (`paint.ts`), the pane and its keys
 * (`pane.ts`), messages to a subagent (`messages.ts`), the palette's commands and the two slots.
 */

import { defaultKeys } from "@opencode-cockpit/client/catalog"
import { claimFeature, duplicateFeatureMessage } from "@opencode-cockpit/client/feature"
import { bindingLookup, dualTui, type Host } from "@opencode-cockpit/client/host"
import { noticeText } from "@opencode-cockpit/client/settings"
import { loadSubagents, type SubagentsConfig } from "../core/config.ts"
import type { Change } from "../core/model/changes.ts"
import { applyAll, emptyModel, type Node, rootOf, type Session, subagentsOf } from "../core/model/model.ts"
import { createMessages, type Messages, YOURS_KEY } from "./messages.ts"
import { createPainter } from "./paint.ts"
import { createPane, FULL_KEY, THINKING_KEY } from "./pane.ts"
import { createSource } from "./source.ts"
import type { Surface } from "./surface.ts"
import { Overlay } from "./view/overlay.tsx"
import { SidebarBlock } from "./view/sidebar.tsx"

const SUBAGENTS_PACKAGE = "@opencode-cockpit/subagents"

const DEFAULT_KEYS = defaultKeys("subagents")

/** The `subagents` section of the config files, then the plugin entry's options (core/config.ts). */
export type SubagentsTuiOptions = SubagentsConfig

/** Subagents removed from the list, by id — kept across restarts, the newest few hundred. */
const HIDDEN_KEY = "cockpit.subagents.hidden"
const HIDDEN_MAX = 300
/** How long a run may say nothing before the host is asked whether it is still going. */
const QUIET_MS = 20_000

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
    const { config: options, order, notices } = loadSubagents(api.state.path.directory, rawOptions)
    for (const notice of notices) log.warn("settings", { file: notice.file, notice: notice.text })
    if (!options.enabled) {
      log.info("off in the settings")
      return
    }
    /** Said in the block for the session, one `!` row each, until the file is fixed. */
    const warnings = notices.map(noticeText)
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
    let root: string | undefined

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
    const busy = (session: Session) => session.status === "running" || session.status === "starting"
    const working = () => nodes().some(({ session }) => busy(session) || session.status === "waiting")
    const painter = createPainter({ api, log, options, warnings, model, surface, yours, nodes, opened, busy })
    const draw = painter.draw
    const set = (change: Partial<Surface>) => {
      Object.assign(surface, change)
      draw()
    }

    // --- data --------------------------------------------------------------------------------------

    const feed = createSource(api, log, (changes: Change[]) => {
      if (changes.length === 0) return
      applyAll(model, changes)
      for (const change of changes) {
        if (change.type === "status" && change.status !== "busy" && change.status !== "waiting")
          messages.relay(change.id)
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
    const checkedOrphans = new Set<string>()
    const reconcile = () => {
      const now = Date.now()
      for (const { session } of nodes()) {
        /**
         * Settled as stopped because the subagent that launched it ended (core/model): asked once
         * whether it still works — OpenCode 1 has no event to correct us, and a background child can
         * outlive its parent. Only a "busy" is taken; "not running" keeps it stopped, not done.
         */
        if (session.orphaned !== undefined && !checkedOrphans.has(session.id)) {
          checkedOrphans.add(session.id)
          const busy = feed
            .check(session.id)
            .find((change) => change.type === "status" && change.status === "busy")
          if (busy) {
            log.info("orphaned run still working", { id: session.id })
            applyAll(model, [{ ...busy, at: now }])
            draw()
          }
          continue
        }
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
      if (painter.resized()) draw()
      if (working()) {
        painter.tick()
        draw()
      } else if (options.hideFinishedAfterMinutes !== undefined || painter.fading()) draw() // finished ones age out with nothing running
    }, 1000)

    const messages: Messages = createMessages({
      api,
      log,
      model,
      surface,
      yours,
      feed: () => feed,
      opened,
      busy,
      draw,
      set,
    })
    const pane = createPane({
      api,
      log,
      model,
      surface,
      painter,
      messages,
      feed,
      hidden,
      saveHidden,
      isHidden,
      nodes,
      opened,
      busy,
      follow,
      set,
    })

    api.keymap.registerLayer({
      commands: [
        {
          name: "cockpit.subagents.open",
          title: "Open the subagents",
          category: "Cockpit · Subagents",
          namespace: "palette",
          slashName: "subagents",
          run: () => pane.openLatest(),
        },
        {
          name: "cockpit.subagents.clearFinished",
          title: "Clear finished subagents",
          desc: "from the sidebar",
          category: "Cockpit · Subagents",
          namespace: "palette",
          run: () => pane.clearFinished(),
        },
        {
          name: "cockpit.subagents.restore",
          title: "Show removed subagents again",
          category: "Cockpit · Subagents",
          namespace: "palette",
          run: () => pane.restore(),
        },
      ],
      bindings: keys.gather("cockpit", Object.keys(DEFAULT_KEYS)),
    })

    api.slots.register({
      /** Where the top-level `sidebar` list puts it: under Status and above Shells by default. */
      order,
      slots: {
        sidebar_content: () => (
          <SidebarBlock
            api={api}
            lines={painter.lines}
            onOpen={pane.open}
            onReady={(box) => painter.setBlock(box)}
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
            onReady={(parts) => painter.attach(parts)}
            /** Clicking off the pane closes it; at full width there is no "off" to click. */
            onDismiss={() => {
              if (!surface.full) pane.close()
            }}
            onClick={(y) => pane.click(y)}
            onScroll={(delta) => pane.scroll(delta)}
          />
        ),
      },
    })

    follow()
    api.lifecycle.onDispose(() => {
      clearInterval(slow)
      slow = undefined
      pane.dispose()
      feed.dispose()
    })
  }
}

/** One entry for both OpenCodes: v1 calls `tui`, v2 calls `setup` (docs/opencode/v2.md). */
export default dualTui("opencode-cockpit.subagents", createSubagentsTui())
