/** @jsxImportSource @opentui/solid */

import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { claimFeature, duplicateFeatureMessage } from "@opencode-cockpit/client/feature"
import { createMemo } from "solid-js"
import pkg from "../../package.json" with { type: "json" }
import { asSegmentConfig, loadStatusConfig, type ResolvedLine, resolveLines } from "../core/config.ts"
import { loadCustomSegments } from "../core/custom.ts"
import { fit, fitColumn } from "../core/render.ts"
import { buildSegments, type SegmentDef } from "../core/segments.ts"
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

    const directory = api.state.path.directory
    const config = loadStatusConfig(directory, rawOptions)
    if (config.enabled === false) return

    // Your own segments, loaded before the first draw so they are never missing from frame one.
    let custom: ReadonlyMap<string, SegmentDef> = new Map()
    if (config.modules?.length) {
      const loaded = await loadCustomSegments(config.modules, directory)
      custom = loaded.segments
      // A module that will not load is worth saying out loud: its segments silently vanish.
      for (const error of loaded.errors) {
        api.ui.toast({ variant: "error", title: "Statusline", message: error, duration: 10_000 })
      }
    }

    const lines = resolveLines(config)
    const store = createStatusStore(api, config, { version: pkg.version, build: buildContext })
    api.lifecycle.onDispose(() => store.dispose())

    /** A line, fitted to the room its surface actually has. */
    const line = (spec: ResolvedLine, width: () => number) => {
      const segments = createMemo(() => {
        const built = buildSegments(store.context(), spec.segments.map(asSegmentConfig), {
          custom,
          icons: spec.icons,
        })
        return spec.stack === "vertical"
          ? fitColumn(built, width(), spec.maxRows).segments
          : fit(built, width(), spec.separator).segments
      })
      return (
        <StatusLine
          api={api}
          segments={segments}
          separator={spec.separator}
          stack={spec.stack}
          paddingLeft={spec.paddingLeft}
          paddingRight={spec.paddingRight}
          paddingTop={spec.paddingTop}
          paddingBottom={spec.paddingBottom}
        />
      )
    }

    const on = (surface: string) => lines.filter((spec) => spec.surface === surface)
    const bottom = on("bottom")
    const sidebar = on("sidebar")

    api.slots.register({
      // After the shell dock (150), so the line sits at the very bottom of the window.
      order: 200,
      slots: {
        app_bottom: () => (
          <>
            {bottom.map((spec) =>
              line(spec, () => api.renderer.width - spec.paddingLeft - spec.paddingRight),
            )}
          </>
        ),
        // sidebar_content, not sidebar_footer: the host does not draw plugin content in the footer.
        sidebar_content: () => (
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
