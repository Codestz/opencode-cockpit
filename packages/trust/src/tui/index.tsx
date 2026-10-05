/** @jsxImportSource @opentui/solid */

/**
 * Trust's interface half — the only half it has. OpenCode's `permission.ask` server hook is declared
 * and never called (docs/opencode/permissions.md), so a plugin answers a request the way OpenCode's
 * own auto mode does: from the interface, on `permission.asked`, with a reply of "once".
 *
 * Everything that decides is in `core/`; this file wires it to the host: the ledger file read and
 * appended, the painter (`paint.ts`), requests in and replies out (`requests.ts`), `/trust`
 * (`ledger.tsx`), the palette's commands and the sidebar block.
 */

import { defaultKeys } from "@opencode-cockpit/client/catalog"
import { claimFeature, duplicateFeatureMessage } from "@opencode-cockpit/client/feature"
import { bindingLookup, dualTui, type Host } from "@opencode-cockpit/client/host"
import { loadTrust, resolveSettings, type TrustConfig } from "../core/config.ts"
import { createEngine } from "../core/engine.ts"
import type { Event } from "../core/ledger.ts"
import { trustPaths } from "../core/paths.ts"
import { createJournal } from "./journal.ts"
import { createLedger } from "./ledger.tsx"
import { closedDialog, createPainter, type Live } from "./paint.ts"
import { createRequests } from "./requests.ts"
import { Rows } from "./view/rows.tsx"

const TRUST_PACKAGE = "@opencode-cockpit/trust"

const DEFAULT_KEYS = defaultKeys("trust")

export type TrustTuiOptions = TrustConfig

/** How often other windows' events are read from the ledger, and pending requests checked. */
const SYNC_MS = 3_000

/** Trust's interface half as a factory, so the `opencode-cockpit` bundle can include it. */
export function createTrustTui({ source = TRUST_PACKAGE }: { source?: string } = {}) {
  return async (api: Host, rawOptions?: unknown) => {
    const log = api.log.child("trust")
    const claim = claimFeature(api.renderer, "trust", source)
    if (!claim.active) {
      log.warn("configured twice", { owner: claim.owner, skipped: source })
      api.ui.toast({
        variant: "warning",
        title: "Trust",
        message: duplicateFeatureMessage("Trust", claim.owner, source),
      })
      return
    }
    api.lifecycle.onDispose(() => claim.release())

    const directory = api.state.path.directory
    const { config, order, notices } = await loadTrust(directory, rawOptions)
    for (const notice of notices) log.warn("settings", { file: notice.file, notice: notice.text })
    const settings = resolveSettings(config)
    if (!settings.enabled) {
      log.info("off by config", { directory })
      return
    }
    const keys = bindingLookup({ ...DEFAULT_KEYS, ...config.keybinds })
    const paths = trustPaths(directory)
    const journal = createJournal(paths)
    const engine = createEngine({ ...settings, keep: 20 })
    const project = directory.split(/[\\/]/).filter(Boolean).at(-1) ?? ""
    const live: Live = { trouble: undefined, inSidebar: settings.sidebar }
    const dialog = closedDialog()
    const painter = createPainter({ api, log, engine, settings, notices, project, live, dialog })
    const { draw, paint } = painter

    // --- the ledger file ---------------------------------------------------------------------------

    /** Everything new in the file — this window's events and every other's — into the state. */
    const sync = () =>
      journal
        .read()
        .then(({ events, reset }) => {
          if (events.length === 0 && !reset) return
          engine.load(events, { reset })
          draw()
        })
        .catch((error) => {
          log.error("ledger unreadable", { file: paths.events, error })
          live.trouble = "ledger unreadable — see cockpit.log"
          draw()
        })

    const write = (events: readonly Event[]) => {
      if (events.length === 0) return
      journal
        .append(events)
        .then(() => {
          if (live.trouble?.startsWith("ledger not saved")) live.trouble = undefined
          return sync()
        })
        .catch((error) => {
          log.error("ledger not saved", { file: paths.events, error })
          live.trouble = `ledger not saved: ${(error as NodeJS.ErrnoException).code ?? "error"}`
          draw()
        })
    }

    const requests = createRequests({ api, log, engine, directory, live, write, draw })
    const ledger = createLedger({
      api,
      log,
      engine,
      directory,
      painter,
      dialog,
      write,
      loadRules: requests.loadRules,
    })

    const boot = async () => {
      await sync()
      await requests.loadRules()
      await requests.reconcile(true)
      log.info("ready", {
        ledger: paths.events,
        threshold: settings.threshold,
        dangerExtra: settings.dangerExtra,
        expireDays: settings.expireDays,
        rules: requests.rulesReady(),
      })
    }
    void boot()

    let ticking: ReturnType<typeof setInterval> | undefined = setInterval(() => {
      void sync()
      if (engine.pending().length > 0) void requests.reconcile(false)
      /** The sidebar was laid out, or resized, since the rows were drawn. */
      if (painter.resized()) draw()
    }, SYNC_MS)

    api.keymap.registerLayer({
      commands: [
        {
          name: "cockpit.trust.ledger",
          title: "Show what Trust answers for you",
          category: "Cockpit · Trust",
          namespace: "palette",
          slashName: "trust",
          run: () => ledger.open(),
        },
        {
          name: "cockpit.trust.sidebar",
          title: "Show or hide Trust in the sidebar",
          desc: "for this session",
          category: "Cockpit · Trust",
          namespace: "palette",
          run: () => {
            live.inSidebar = !live.inSidebar
            log.debug("sidebar", { shown: live.inSidebar })
            paint()
            /** Said as well as drawn: on the home screen there is no sidebar to show it in. */
            api.ui.toast({
              variant: "info",
              title: "Trust",
              message: live.inSidebar ? "Shown in the sidebar." : "Hidden from the sidebar.",
            })
          },
        },
        {
          name: "cockpit.trust.pause",
          title: "Pause or resume Trust in this project",
          category: "Cockpit · Trust",
          namespace: "palette",
          run: () => ledger.togglePause(),
        },
      ],
      bindings: keys.gather("cockpit", Object.keys(DEFAULT_KEYS)),
    })

    api.slots.register({
      /** Last of Cockpit's blocks by default; the top-level `sidebar` list moves it. */
      order,
      slots: {
        sidebar_content: () => (
          <Rows
            api={api}
            rows={painter.sidebarLines}
            onReady={(box) => {
              painter.setBlock(box)
              draw()
            }}
          />
        ),
      },
    })

    api.lifecycle.onDispose(() => {
      requests.dispose()
      clearInterval(ticking)
      ticking = undefined
    })
  }
}

/** One entry for both OpenCodes: v1 calls `tui`, v2 calls `setup` (docs/opencode/v2.md). */
export default dualTui("opencode-cockpit.trust", createTrustTui())
