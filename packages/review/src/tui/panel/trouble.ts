/**
 * Where a failure goes, and what it says while it is still on screen.
 *
 * A plugin that throws inside a key handler either kills the surface or is swallowed by the host, and
 * both look identical from the outside — which is why "it crashes sometimes" went unexplained for so
 * long. Everything the panel does runs through the guard built here: a toast so you know now, a file
 * so it can be read later, and a line in the footer for as long as it is worth the space.
 */

import { appendFile, mkdir } from "node:fs/promises"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createGuard, type Guard } from "../../core/guard.ts"
import { metrics } from "../../core/perf.ts"
import { reviewPaths } from "../../core/store/paths.ts"
import { statsLines } from "../../core/view/stats.ts"
import type { Store } from "../data/changes.ts"
import type { Surface } from "./surface.ts"

export interface Trouble {
  guard: Guard
  /** What went wrong recently, if it is recent enough to still be worth the footer. */
  notice: () => string | undefined
}

export function createTrouble({
  api,
  surface,
  store,
}: {
  api: TuiPluginApi
  surface: Surface
  store: Store
}): Trouble {
  /**
   * What was true when something went wrong.
   *
   * Gathered only after a throw, so it can be as expensive as it likes — and it is the difference
   * between a stack that names a line and a report you can actually act on.
   */
  const situation = (): string =>
    [
      `variant ${surface.variant}  source ${store.source()}  pane ${surface.view.pane ?? "files"}`,
      `file ${surface.view.file ?? "none"}  line ${surface.view.line ?? "none"}  scroll ${surface.view.scroll ?? 0}`,
      `terminal ${api.renderer.width}x${api.renderer.height}  files ${store.current().changes.files.length}  threads ${surface.review.threads.length}`,
      ...statsLines(metrics.snapshot()).map((line) => `  ${line}`),
    ].join("\n")

  /**
   * Nothing may take the session down, and nothing may fail in silence.
   *
   * A toast so you know now, a file so we can read it later. The pane stays up with the trouble in
   * its footer: losing your place in a review is worse than one visibly broken row, and a pane that
   * closes itself takes the evidence with it.
   */
  const guard = createGuard({
    meter: metrics,
    context: situation,
    report: (trouble, detail) => {
      api.ui.toast({
        variant: "error",
        title: "Review",
        message: `${trouble.where}: ${trouble.message}`,
        duration: 8_000,
      })
      const where = reviewPaths(api.state.path.worktree || api.state.path.directory, api.state.vcs?.branch)
      void mkdir(where.dir, { recursive: true })
        .then(() => appendFile(where.log, detail))
        .catch(() => {})
    },
  })

  /** The trouble is worth the footer for a while, then the keys are worth more. */
  const notice = (): string | undefined => {
    const trouble = guard.last()
    if (!trouble || Date.now() - trouble.at > 12_000) return undefined
    const again = trouble.seen > 1 ? ` (×${trouble.seen})` : ""
    return `${trouble.where}: ${trouble.message}${again} — written to trouble.log`
  }

  return { guard, notice }
}
