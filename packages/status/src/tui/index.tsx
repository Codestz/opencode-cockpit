/** @jsxImportSource @opentui/solid */

import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { claimFeature, duplicateFeatureMessage } from "@opencode-cockpit/client/feature"
import { createMemo } from "solid-js"
import pkg from "../../package.json" with { type: "json" }
import { asSegmentConfig, loadStatusConfig, resolveLines } from "../core/config.ts"
import { fit } from "../core/render.ts"
import { buildSegments } from "../core/segments.ts"
import { StatusLine } from "./components/statusline.tsx"
import { buildContext } from "./state/snapshot.ts"
import { createStatusStore } from "./state/store.ts"

const STATUS_PACKAGE = "@opencode-cockpit/status"

/** Status' TUI half as a factory, so bundles such as `opencode-cockpit` can include it. */
export function createStatusTui({ source = STATUS_PACKAGE }: { source?: string } = {}): TuiPlugin {
  return async (api, rawOptions) => {
    // The renderer is shared by every TUI plugin in this OpenCode window.
    const claim = claimFeature(api.renderer, "status", source)
    if (!claim.active) {
      api.ui.toast({
        variant: "warning",
        title: "opencode-cockpit",
        message: duplicateFeatureMessage("Statusline", claim.owner, source),
        duration: 10_000,
      })
      return
    }
    api.lifecycle.onDispose(() => claim.release())

    const config = loadStatusConfig(api.state.path.directory, rawOptions)
    if (config.enabled === false) return

    const lines = resolveLines(config)
    const store = createStatusStore(api, config, { version: pkg.version, build: buildContext })
    api.lifecycle.onDispose(() => store.dispose())

    /** A line, fitted to the room its surface actually has. */
    const line = (spec: (typeof lines)[number], width: () => number) => {
      const segments = createMemo(() => {
        const built = buildSegments(store.context(), spec.segments.map(asSegmentConfig))
        return fit(built, width(), spec.separator).segments
      })
      return <StatusLine api={api} segments={segments} separator={spec.separator} />
    }

    const on = (surface: string) => lines.filter((spec) => spec.surface === surface)
    const bottom = on("bottom")
    const promptRight = on("promptRight")
    const sidebar = on("sidebar")

    api.slots.register({
      // After the shell dock (150), so the line sits at the very bottom of the window.
      order: 200,
      slots: {
        app_bottom: () => <>{bottom.map((spec) => line(spec, () => api.renderer.width - 2))}</>,
        // The prompt's right-hand side is narrow; a third of the window is as much as it can take.
        session_prompt_right: () => (
          <>{promptRight.map((spec) => line(spec, () => Math.floor(api.renderer.width / 3)))}</>
        ),
        sidebar_footer: () => (
          <>{sidebar.map((spec) => line(spec, () => Math.max(10, Math.floor(api.renderer.width / 4))))}</>
        ),
      },
    })
  }
}

const plugin: TuiPluginModule & { id: string } = {
  id: STATUS_PACKAGE,
  tui: createStatusTui(),
}
export default plugin
