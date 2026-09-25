/** @jsxImportSource @opentui/solid */

import { claimFeature, duplicateFeatureMessage } from "@opencode-cockpit/client/feature"
import { dualTui, type Host } from "@opencode-cockpit/client/host"
import { sidebarOrder } from "@opencode-cockpit/client/sidebar"
import { createMemo } from "solid-js"
import pkg from "../../package.json" with { type: "json" }
import { asSegmentConfig, loadStatusConfig, type ResolvedLine, resolveLines } from "../core/config.ts"
import { loadCustomSegments } from "../core/custom.ts"
import { statuslineBrief } from "../core/instructions.ts"
import { moduleNotice, overflowNotice } from "../core/notices.ts"
import { fit, fitColumn } from "../core/render.ts"
import { buildReport } from "../core/report.ts"
import { buildSegments, type SegmentDef } from "../core/segments.ts"
import { StatusLine } from "./components/statusline.tsx"
import { buildContext, currentSession } from "./state/snapshot.ts"
import { createStatusStore } from "./state/store.ts"

const STATUS_PACKAGE = "@opencode-cockpit/status"

/** Status' TUI half as a factory, so bundles such as `opencode-cockpit` can include it. */
export function createStatusTui({ source = STATUS_PACKAGE }: { source?: string } = {}) {
  return async (api: Host, rawOptions?: unknown) => {
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
    const moduleErrors: string[] = []
    if (config.modules?.length) {
      const loaded = await loadCustomSegments(config.modules, directory)
      custom = loaded.segments
      /**
       * A module that will not load is worth saying out loud twice over: its segments simply are
       * not there, which looks exactly like a plugin that did nothing. The toast is gone in ten
       * seconds, so the reason also goes to OpenCode's log, where it can still be read afterwards
       * — a whole session was once spent diagnosing an import that had already explained itself
       * and then disappeared.
       */
      moduleErrors.push(...loaded.errors)
      for (const error of loaded.errors) {
        api.log.error("status: module failed to load", { error })
        api.ui.toast({ variant: "error", title: "Statusline", message: error, duration: 10_000 })
        void api.v1?.client.app
          .log({
            service: "opencode-cockpit.status",
            level: "error",
            message: `statusline module failed to load: ${error}`,
          })
          .catch(() => {})
      }
    }

    const lines = resolveLines(config)
    const store = createStatusStore(api, config, { version: pkg.version, build: buildContext })
    api.lifecycle.onDispose(() => store.dispose())

    /**
     * The line's own failures, drawn once rather than on every surface. A module that would not
     * load has no segments to be missing from, so without a row of its own the only notice is a
     * toast that is gone in ten seconds — and the log, which nobody reads while looking at a line
     * that seems to have quietly done nothing.
     */
    const failure = moduleNotice(moduleErrors)
    let noticeShown = false

    /** A line, fitted to the room its surface actually has. */
    const line = (spec: ResolvedLine, width: () => number) => {
      const mine = failure && !noticeShown
      if (mine) noticeShown = true
      const segments = createMemo(() => {
        const built = buildSegments(store.context(), spec.segments.map(asSegmentConfig), {
          custom,
          icons: spec.icons,
          debug: spec.debug,
        })
        if (mine && failure) built.unshift(failure)
        if (spec.stack !== "vertical") return fit(built, width(), spec.separator).segments
        /**
         * Say how many rows did not fit. The preview has always printed `↳ N dropped`; the TUI
         * left them out in silence, and a row that never appears reads as a broken segment. The
         * notice takes a row of its own, so the fit is redone with one fewer to give it room.
         */
        const first = fitColumn(built, width(), spec.maxRows)
        if (first.dropped === 0) return first.segments
        const room = fitColumn(built, width(), Math.max(1, spec.maxRows - 1))
        const overflow = overflowNotice(room.dropped)
        return overflow ? [...room.segments, overflow] : room.segments
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

    /**
     * `/statusline` draws nothing. Customising a line is an editing job in a file the TUI never
     * names, so the useful thing is not a help panel the user then has to act on themselves — it is
     * a brief handed to the agent already in the session, carrying what it cannot look up: which
     * config file this project reads, what is in it now, and what would not load.
     */
    api.keymap.registerLayer({
      commands: [
        {
          name: "cockpit.status.customise",
          title: "Statusline: ask the agent to customise it",
          category: "Statusline",
          namespace: "palette",
          slashName: "statusline",
          run: () => {
            const brief = statuslineBrief(
              buildReport({
                version: pkg.version,
                directory,
                lines,
                modules: config.modules,
                registered: custom.size,
                errors: moduleErrors,
              }),
            )
            /**
             * Sent, not left in the prompt. The brief is forty lines; parked in the input it is a
             * wall of text the user has to scroll past to type their own sentence, and it ends by
             * asking what they want anyway — so the agent is the right place for it to land.
             *
             * On the next tick, because running a slash command clears the prompt it was typed
             * into: writing during the command itself is wiped a moment later, which looks exactly
             * like a command that did nothing.
             */
            setTimeout(() => {
              const failed = () => {
                api.log.warn("status: could not reach the prompt")
                api.ui.toast({ variant: "error", title: "Statusline", message: "could not reach the prompt" })
              }
              if (api.v1) {
                const tui = api.v1.client.tui
                void tui
                  .appendPrompt({ text: brief })
                  .then(() => tui.submitPrompt())
                  .catch(failed)
                return
              }
              /** OpenCode 2: straight to the conversation on screen, there being no prompt to fill. */
              const session = currentSession(api)
              if (!session) {
                api.ui.toast({ title: "Statusline", message: "Open a conversation first." })
                return
              }
              void api.promptSession(session, brief).catch(failed)
            }, 0)
          },
        },
      ],
    })

    const on = (surface: string) => lines.filter((spec) => spec.surface === surface)
    const bottom = on("bottom")
    const sidebar = on("sidebar")

    api.slots.register({
      /** After the shell dock (150), so the line sits at the very bottom of the window. */
      order: 200,
      slots: {
        app_bottom: () => (
          <>
            {bottom.map((spec) =>
              line(spec, () => api.renderer.width - spec.paddingLeft - spec.paddingRight),
            )}
          </>
        ),
      },
    })
    api.slots.register({
      /**
       * First in the sidebar by default — statusline, subagents, shells. `"sidebar"` in Cockpit's
       * config, or `sidebarOrder`, moves it; lower draws first.
       */
      order: sidebarOrder("status", 140, config.sidebarOrder, { directory: api.state.path.directory }),
      slots: {
        // sidebar_content, not sidebar_footer: the host does not draw plugin content in the footer.
        sidebar_content: () => (
          <>{sidebar.map((spec) => line(spec, () => Math.max(10, Math.floor(api.renderer.width / 4))))}</>
        ),
      },
    })
  }
}

/** One entry for both OpenCodes: v1 calls `tui`, v2 calls `setup` (docs/opencode/v2.md). */
export default dualTui("opencode-cockpit.status", createStatusTui())
