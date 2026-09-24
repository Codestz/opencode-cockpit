/** @jsxImportSource @opentui/solid */

import { rmSync } from "node:fs"
import { homedir } from "node:os"
import { basename } from "node:path"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { claimFeature, duplicateFeatureMessage } from "@opencode-cockpit/client/feature"
import { dualTui, type Host } from "@opencode-cockpit/client/host"
import { type ApplyIo, applyPlan, manualSteps, readiness } from "../core/apply.ts"
import { nodeDisk } from "../core/disk.ts"
import { type GatherIo, gather } from "../core/gather.ts"
import type { Source } from "../core/plan.ts"
import { fetchAllLatest, registryFrom } from "../core/registry.ts"
import { updateCheckEnabled } from "../core/settings.ts"
import { runOpencode } from "../core/spawn.ts"
import { UpdaterDialog } from "./dialog.tsx"

const UPDATER_PACKAGE = "@opencode-cockpit/updater"
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The OpenCode that is running, to run `opencode plugin` with — not whichever one PATH finds first,
 * which may be a different install writing a different config. A host started some other way (a
 * development checkout under `bun`) falls back to PATH.
 */
function opencodeBin(): string {
  return basename(process.execPath).startsWith("opencode") ? process.execPath : "opencode"
}

function gatherIo(api: TuiPluginApi): GatherIo {
  const worktree = api.state.path.worktree
  return {
    env: process.env,
    home: homedir(),
    ...(worktree && worktree !== "/" ? { worktree } : {}),
    disk: nodeDisk,
    fetchLatest: (names) => fetchAllLatest(names, { registry: registryFrom(process.env) }),
    listed: api.plugins
      .list()
      .map((p) => ({ id: p.id, source: p.source as Source, spec: p.spec, target: p.target })),
  }
}

const applyIo: ApplyIo = {
  disk: nodeDisk,
  opencode: (args, cwd) => runOpencode(opencodeBin(), args, cwd),
  remove: (dir) => rmSync(dir, { recursive: true, force: true }),
}

function openUpdater(api: TuiPluginApi): void {
  const io = gatherIo(api)
  api.ui.dialog.replace(
    () => (
      <UpdaterDialog
        api={api}
        home={io.home}
        load={() => gather(io)}
        ready={() => readiness(applyIo, api.state.path.directory || io.home)}
        apply={(plan, found) => applyPlan(plan, found, applyIo)}
        manualSteps={manualSteps}
        onClose={() => api.ui.dialog.clear()}
      />
    ),
    () => {},
  )
  api.ui.dialog.setSize("xlarge")
}

/**
 * One registry check a day, and one toast per set of updates.
 *
 * Silence when there is nothing; a count and the command when there is. The same set is announced
 * once, so a person who chose not to update is not told again tomorrow.
 */
async function announce(api: TuiPluginApi): Promise<void> {
  const now = Date.now()
  const last = api.kv.get<number | undefined>("cockpit.updater.checkedAt", undefined)
  if (last !== undefined && now - last < DAY_MS) return
  api.kv.set("cockpit.updater.checkedAt", now)
  const found = await gather(gatherIo(api))
  const behind = found.plans.filter((p) => p.state === "update")
  if (behind.length === 0) return
  const signature = behind.map((p) => `${p.name}@${p.published}`).join(",")
  if (api.kv.get<string>("cockpit.updater.announced", "") === signature) return
  api.kv.set("cockpit.updater.announced", signature)
  api.ui.toast({
    variant: "info",
    title: "Plugins",
    message:
      behind.length === 1
        ? `${behind[0]?.name} ${behind[0]?.published} is available. Run /plugins-update.`
        : `${behind.length} plugin updates available. Run /plugins-update.`,
    duration: 10_000,
  })
}

/** The Updater's TUI as a factory, so bundles such as `opencode-cockpit` can include it. */
export function createUpdaterTui({ source = UPDATER_PACKAGE }: { source?: string } = {}) {
  return async (host: Host, options?: unknown) => {
    const claim = claimFeature(host.renderer, "updater", source)
    if (!claim.active) {
      host.ui.toast({
        variant: "warning",
        title: "opencode-cockpit",
        message: duplicateFeatureMessage("Updater", claim.owner, source),
        duration: 10_000,
      })
      return
    }
    host.lifecycle.onDispose(() => claim.release())

    /**
     * OpenCode 2 checks and updates plugins itself (`opencode plugin check|update`), and resolves
     * unpinned ones on start — the freeze this bay exists for does not happen there. The commands stay,
     * so the habit still lands somewhere, and point at the host's own.
     */
    const api = host.v1
    const open = api
      ? () => openUpdater(api)
      : () =>
          host.ui.toast({
            title: "Plugins",
            message:
              "OpenCode 2 updates plugins itself: run `opencode plugin check`, then `opencode plugin update`.",
            duration: 10_000,
          })

    host.keymap.registerLayer({
      commands: [
        {
          name: "cockpit.updater.open",
          title: "Update plugins",
          category: "Plugins",
          namespace: "palette",
          slashName: "plugins-update",
          run: open,
        },
        {
          // Old toasts, old docs and habit all say /cockpit-update; it now opens the same screen.
          name: "cockpit.updater.legacy",
          title: "Update plugins (was: update opencode-cockpit)",
          category: "Plugins",
          namespace: "palette",
          slashName: "cockpit-update",
          run: open,
        },
      ],
      bindings: [],
    })
    if (!api) return

    // Never in the way of starting up, and never loud about failing: offline is not news.
    const where = { env: process.env, home: homedir(), directory: api.state.path.directory }
    if (updateCheckEnabled(nodeDisk, where, options)) {
      setTimeout(() => void announce(api).catch(() => {}), 5_000)
    }
  }
}

/** One entry for both OpenCodes: v1 calls `tui`, v2 calls `setup` (docs/opencode/v2.md). */
export default dualTui(UPDATER_PACKAGE, createUpdaterTui())
