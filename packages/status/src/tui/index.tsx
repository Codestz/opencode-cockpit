/** @jsxImportSource @opentui/solid */

import { claimFeature, duplicateFeatureMessage } from "@opencode-cockpit/client/feature"
import { dualTui, type Host } from "@opencode-cockpit/client/host"
import { briefAgent } from "@opencode-cockpit/client/setup"
import type { BoxRenderable } from "@opentui/core"
import { createMemo } from "solid-js"
import pkg from "../../package.json" with { type: "json" }
import { asSegmentConfig, loadStatus, type ResolvedLine, resolveLines } from "../core/config.ts"
import { loadCustomSegments } from "../core/custom.ts"
import { OLD_SLASH, SETUP_SLASH, statusSetupBrief } from "../core/instructions.ts"
import { moduleNoticeText, noticeRows, overflowNotice } from "../core/notices.ts"
import { fit, fitColumn } from "../core/render.ts"
import { buildReport } from "../core/report.ts"
import { buildSegments, type SegmentDef } from "../core/segments.ts"
import { StatusLine } from "./components/statusline.tsx"
import { buildContext } from "./state/snapshot.ts"
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
        message: duplicateFeatureMessage("Status", claim.owner, source),
        duration: 10_000,
      })
      return
    }
    api.lifecycle.onDispose(() => claim.release())

    const directory = api.state.path.directory
    const { config, order, notices, settings } = loadStatus({ options: rawOptions, where: { directory } })
    for (const notice of notices) api.log.warn("status: settings", { notice })
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
        api.ui.toast({ variant: "error", title: "Status", message: error, duration: 10_000 })
        void api.v1?.client.app
          .log({
            service: "opencode-cockpit.status",
            level: "error",
            message: `status module failed to load: ${error}`,
          })
          .catch(() => {})
      }
    }

    const lines = resolveLines(config)
    const store = createStatusStore(api, config, { version: pkg.version, build: buildContext })
    api.lifecycle.onDispose(() => store.dispose())

    /**
     * The line's own trouble — a setting no longer read, a file that would not parse, a module that
     * would not load — drawn once, as `!` rows above the first line, and for the whole session: the
     * toast is gone in ten seconds and the log is not where anyone looks at a line that seems to have
     * quietly done nothing. Status draws the notices that belong to no bay, too, being the one bay
     * every install has.
     */
    const troubles = [...notices, ...moduleErrors.map(moduleNoticeText)]

    const on = (surface: string) => lines.filter((spec) => spec.surface === surface)
    const bottom = on("bottom")
    const sidebar = on("sidebar")
    /** The sidebar's when there is one: it is where the default draws, and where a notice has room. */
    const noticeLine = sidebar[0] ?? bottom[0]

    /**
     * A line, fitted to the room its surface actually has. A sidebar line measures it, as Subagents
     * and Trust do: the container the host gave it, once laid out, and a guess before that. Guessed,
     * a notice padded to a quarter of the window ran past the sidebar's edge and lost its last words.
     */
    const line = (spec: ResolvedLine, guess: () => number, measure = false) => {
      let box: BoxRenderable | undefined
      const width = () => {
        if (!measure) return guess()
        /**
         * The parent, not the line's own box: the box is as wide as its widest row, so a row that
         * gave up a word for want of room would keep the box — and itself — that narrow for good.
         */
        const parent = (box?.parent as { width?: number } | null | undefined)?.width ?? 0
        return parent >= 12 ? parent : guess()
      }
      /** Read on the tick too, so a width the host settles after the first frame is picked up. */
      const said = createMemo(() => {
        store.context()
        return spec === noticeLine ? noticeRows(troubles, width()) : []
      })
      const segments = createMemo(() => {
        /** The room this line has, rather than the window's: a row with a word to spare uses it. */
        const ctx = { ...store.context(), width: width() }
        const built = buildSegments(ctx, spec.segments.map(asSegmentConfig), {
          custom,
          icons: spec.icons,
          debug: spec.debug,
        })
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
          notices={said}
          onReady={(ready) => {
            box = ready
          }}
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
     * `/status-setup` draws nothing. Setting up the line is an editing job in a file the TUI never
     * names, so the useful thing is not a help panel the user then has to act on themselves — it is
     * a brief handed to the agent already in the session, carrying what it cannot look up: which
     * config file this project reads, what is in it now, and what would not load.
     */
    const brief = () =>
      statusSetupBrief(
        buildReport({
          version: pkg.version,
          directory,
          files: settings.files,
          lines,
          modules: config.modules,
          registered: custom.size,
          errors: moduleErrors,
          notices,
        }),
      )
    const send = () => {
      const text = brief()
      /**
       * Sent, not left in the prompt. The brief is forty lines; parked in the input it is a wall of
       * text the user has to scroll past to type their own sentence, and it ends by asking what they
       * want anyway — so the agent is the right place for it to land.
       *
       * `briefAgent` sends it on the next tick (a slash command clears the prompt it was typed into),
       * queues it behind a reply in progress, and from home opens a conversation for it — the same
       * path as /cockpit-setup.
       */
      briefAgent(api, text, "Status")
    }

    api.keymap.registerLayer({
      commands: [
        {
          name: "cockpit.status.setup",
          title: "Ask the agent to set up the status bay",
          category: "Cockpit · Status",
          namespace: "palette",
          slashName: SETUP_SLASH,
          run: send,
        },
        /**
         * The old name, for one release (removed in 0.10). A second command rather than an alias:
         * neither OpenCode tells a command which of its names was typed, so only a command of its
         * own can say it was renamed (docs/opencode/settings-and-commands.md, Part B). It says so,
         * then does what it always did, so the habit keeps working while it learns the new name.
         */
        {
          name: "cockpit.status.customise",
          title: `Renamed: use /${SETUP_SLASH}`,
          category: "Cockpit · Status",
          namespace: "palette",
          slashName: OLD_SLASH,
          run: () => {
            api.ui.toast({
              variant: "info",
              title: "Status",
              message: `/${OLD_SLASH} is now /${SETUP_SLASH} — briefing the agent all the same.`,
              duration: 8_000,
            })
            send()
          },
        },
      ],
    })

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
      /** First of Cockpit's blocks by default; the top-level `sidebar` list moves it. */
      order,
      slots: {
        // sidebar_content, not sidebar_footer: the host does not draw plugin content in the footer.
        sidebar_content: () => (
          <>
            {sidebar.map((spec) =>
              line(spec, () => Math.max(20, Math.min(40, Math.floor(api.renderer.width / 4) - 2)), true),
            )}
          </>
        ),
      },
    })
  }
}

/** One entry for both OpenCodes: v1 calls `tui`, v2 calls `setup` (docs/opencode/v2.md). */
export default dualTui("opencode-cockpit.status", createStatusTui())
