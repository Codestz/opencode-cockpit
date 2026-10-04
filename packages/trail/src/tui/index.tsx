/** @jsxImportSource @opentui/solid */

/**
 * Trail's interface half: the sidebar block — what this conversation made, one click from the page —
 * `/trail`, and `/link` for a person to add one by hand.
 *
 * Everything that decides is in `core/`; this file wires it to the host: the conversation on screen
 * found, the painter (`paint.ts`), the trail file and what a person does (`actions.ts`), `/trail`
 * (`dialog.tsx`), the palette's commands and the sidebar block — both surfaces drawn from the same
 * `arrange` as `trail_list`.
 */

import { defaultKeys } from "@opencode-cockpit/client/catalog"
import { claimFeature, duplicateFeatureMessage } from "@opencode-cockpit/client/feature"
import { bindingLookup, dualTui, type Host } from "@opencode-cockpit/client/host"
import { loadTrail } from "../core/config.ts"
import { createJournal } from "../core/journal.ts"
import { trailPaths } from "../core/paths.ts"
import { emptyState } from "../core/store.ts"
import { createActions } from "./actions.ts"
import { closedDialog, createDialog } from "./dialog.tsx"
import { createPainter, type Live } from "./paint.ts"
import { createSessions } from "./source.ts"
import { Rows } from "./view/rows.tsx"

const TRAIL_PACKAGE = "@opencode-cockpit/trail"

const DEFAULT_KEYS = defaultKeys("trail")

/** How often the route is looked at; the trail file is read every few of these. */
const TICK_MS = 1_000
const SYNC_EVERY = 3
const DEPTH = 8

/** Trail's interface half as a factory, so the `opencode-cockpit` bundle can include it. */
export function createTrailTui({ source = TRAIL_PACKAGE }: { source?: string } = {}) {
  return async (api: Host, rawOptions?: unknown) => {
    const log = api.log.child("trail")
    const directory = api.state.path.directory
    const { settings, order, notices } = loadTrail(directory, rawOptions)
    for (const notice of notices) log.warn("settings", { notice })
    if (!settings.enabled) {
      log.info("off by config", { directory })
      return
    }
    const claim = claimFeature(api.renderer, "trail", source)
    if (!claim.active) {
      log.warn("configured twice", { owner: claim.owner, skipped: source })
      api.ui.toast({
        variant: "warning",
        title: "Trail",
        message: duplicateFeatureMessage("Trail", claim.owner, source),
      })
      return
    }
    api.lifecycle.onDispose(() => claim.release())

    const keys = bindingLookup({ ...DEFAULT_KEYS, ...settings.keybinds })
    const paths = trailPaths(directory)
    const journal = createJournal(paths)
    const sessions = createSessions(api, log)
    const project = directory.split(/[\\/]/).filter(Boolean).at(-1) ?? ""
    const live: Live = {
      state: emptyState(),
      root: undefined,
      trouble: undefined,
      inSidebar: settings.sidebar,
      titles: new Map(),
    }
    const dialog = closedDialog()
    const painter = createPainter({ api, log, settings, notices, project, live, dialog })
    const { draw, sidebarLines } = painter
    const actions = createActions({ api, log, live, journal, paths, sessions, draw })
    const trail = createDialog({ api, log, live, dialog, painter, actions, sessions })

    // --- the conversation on screen ----------------------------------------------------------------

    const parents = new Map<string, string | null>()
    let routed: string | undefined
    /** The conversation — the root session — of the session on screen; a subagent's view counts as its parent's. */
    const resolve = async (id: string): Promise<string> => {
      let at = id
      for (let hop = 0; hop < DEPTH; hop++) {
        if (!parents.has(at)) {
          const info = await sessions.get(at)
          if (!info) return at
          parents.set(at, info.parentID ?? null)
          if (info.title && !info.parentID) live.titles.set(info.id, info.title)
        }
        const parent = parents.get(at)
        if (!parent) return at
        at = parent
      }
      return at
    }
    const follow = () => {
      const route = api.route.current
      const id = route.name === "session" ? (route.params?.sessionID as string | undefined) : undefined
      if (id === routed) return
      routed = id
      if (!id) {
        live.root = undefined
        return draw()
      }
      void resolve(id).then((found) => {
        if (routed !== id) return
        live.root = found
        draw()
      })
    }

    /**
     * Ahead of the keymap, because the host's dialog takes `esc` before any layer hears it (Trust's
     * filter does the same).
     */
    api.lifecycle.onDispose(api.keymap.intercept((ctx) => trail.intercept(ctx), { priority: 10_000 }))

    // --- the sidebar -------------------------------------------------------------------------------

    /** A row with a page opens it; one without opens `/trail` on it; `+ N more` opens `/trail`. */
    const sidebarClick = (y: number) => {
      const hit = painter.sidebarView().hits.find((each) => each.y === y)
      if (!hit) return
      if (hit.kind === "open") actions.open(hit.url)
      else if (hit.kind === "select") trail.open({ selected: hit.key })
      else trail.open()
    }

    api.keymap.registerLayer({
      commands: [
        {
          name: "cockpit.trail.open",
          title: "Show what this conversation made",
          category: "Cockpit · Trail",
          namespace: "palette",
          slashName: "trail",
          run: () => trail.open(),
        },
        {
          name: "cockpit.trail.link",
          title: "Add a link to this conversation's trail",
          desc: "a PR, a ticket, a page",
          category: "Cockpit · Trail",
          namespace: "palette",
          slashName: "link",
          run: () => void actions.link().catch((error) => log.warn("link failed", { error })),
        },
        {
          name: "cockpit.trail.copyAll",
          title: "Copy this conversation's trail as markdown",
          category: "Cockpit · Trail",
          namespace: "palette",
          run: () => actions.copyConversation(),
        },
        {
          name: "cockpit.trail.sidebar",
          title: "Show or hide Trail in the sidebar",
          desc: "for this session",
          category: "Cockpit · Trail",
          namespace: "palette",
          run: () => {
            live.inSidebar = !live.inSidebar
            painter.paint()
            /** Said as well as drawn: on the home screen there is no sidebar to show it in. */
            actions.toast(live.inSidebar ? "Shown in the sidebar." : "Hidden from the sidebar.")
          },
        },
      ],
      bindings: keys.gather("cockpit", Object.keys(DEFAULT_KEYS)),
    })

    api.slots.register({
      /** After Shells and before Trust by default; the top-level `sidebar` list moves it. */
      order,
      slots: {
        sidebar_content: () => (
          <Rows
            api={api}
            rows={sidebarLines}
            onReady={(box) => {
              painter.setBlock(box)
              draw()
            }}
            onRow={(y) => sidebarClick(y)}
          />
        ),
      },
    })

    let ticks = 0
    let ticking: ReturnType<typeof setInterval> | undefined = setInterval(() => {
      follow()
      if (++ticks % SYNC_EVERY === 0) void actions.sync()
      if (painter.resized()) draw()
    }, TICK_MS)
    api.lifecycle.onDispose(() => {
      clearInterval(ticking)
      ticking = undefined
    })

    follow()
    await actions.sync()
    draw()
    log.info("ready", { trail: paths.events, sidebar: live.inSidebar, order })
  }
}

/** One entry for both OpenCodes: v1 calls `tui`, v2 calls `setup` (docs/opencode/v2.md). */
export default dualTui("opencode-cockpit.trail", createTrailTui())
