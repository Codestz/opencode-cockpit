/** @jsxImportSource @opentui/solid */

import { createBindingLookup, type TuiPlugin, type TuiPluginModule } from "@opencode-ai/plugin/tui"
import { claimFeature, duplicateFeatureMessage } from "@opencode-cockpit/client/feature"
import type { BoxRenderable } from "@opentui/core"
import type { Source } from "../core/model/review.ts"
import { metrics } from "../core/perf.ts"
import { reviewPaths } from "../core/store/paths.ts"
import { createPersistence } from "../core/store/persist.ts"
import { frameBounds, VARIANTS, type Variant } from "../core/view/frame.ts"
import { FOOTER_ROWS, HEADER_ROWS } from "../core/view/geometry.ts"
import { createStore } from "./data/changes.ts"
import { createActions } from "./panel/actions.ts"
import { paneLayer } from "./panel/keys.ts"
import { createPainter } from "./panel/paint.ts"
import { createPointer } from "./panel/pointer.ts"
import { createQueries } from "./panel/queries.ts"
import { createSurface } from "./panel/surface.ts"
import { createTrouble } from "./panel/trouble.ts"
import { Overlay } from "./view/overlay.tsx"
import { createRowPool, type RowPool } from "./view/pool.ts"

/** Global keys, leader-prefixed and few. `<leader>` is OpenCode's own prefix — `ctrl+x` by default. */
const DEFAULT_KEYS = {
  "cockpit.review.open": "<leader>v",
  "cockpit.review.place": "<leader>r",
}

const REVIEW_PACKAGE = "@opencode-cockpit/review"

/** Above Shell's dock (150), below the statusline (200). */
const SLOT_ORDER = 180

const SOURCES: Source[] = ["worktree", "branch", "session"]

export interface ReviewTuiOptions {
  /** Which placement to open in: right | full. */
  variant?: Variant
  /**
   * What to review on open: worktree | branch | session.
   *
   * Uncommitted by default, because that is what you are looking at nine times in ten — the work
   * that just happened. Branch is for reading a pull request, which is a thing you choose to do.
   */
  source?: Source
  keybinds?: Record<string, string>
}

/**
 * Review's TUI half: what it is made of, and who owns what.
 *
 * This file mounts the panel and holds the pieces together; it does not know how to draw a row, what a
 * key means, or what happens when you press one. Those live beside it — `panel/surface.ts` holds the
 * state, `panel/queries.ts` reads it, `panel/actions.ts` changes it, `panel/keys.ts` says which key
 * does which, `panel/paint.ts` puts it on screen, and `view/` is the tree the slot returns.
 *
 * It was one closure of a thousand lines, for a reason worth remembering: every part of it closed over
 * the same handful of mutable variables, so nothing could be moved out without taking the state with
 * it. Giving that state a name — `Surface` — is what let everything else leave.
 */
export function createReviewTui({ source = REVIEW_PACKAGE }: { source?: string } = {}): TuiPlugin {
  return async (api, rawOptions) => {
    // The renderer is shared by every TUI plugin in this OpenCode window.
    const claim = claimFeature(api.renderer, "review", source)
    if (!claim.active) {
      api.ui.toast({
        variant: "warning",
        title: "opencode-cockpit",
        message: duplicateFeatureMessage("Review", claim.owner, source),
        duration: 10_000,
      })
      return
    }
    api.lifecycle.onDispose(() => claim.release())

    const options = (rawOptions ?? {}) as ReviewTuiOptions
    const keys = createBindingLookup({ ...DEFAULT_KEYS, ...options.keybinds })
    const store = createStore(api, options.source ?? "worktree")
    const surface = createSurface(options.variant ?? "right")

    /**
     * The renderables the slot hands back, which do not exist until it mounts.
     *
     * Plain variables, not signals. Nothing inside a slot's tree is reactive, so state the panel must
     * reflect is state the panel is *told* about — see `view/pool.ts`.
     */
    let backdrop: BoxRenderable | undefined
    let panel: BoxRenderable | undefined
    let pool: RowPool | undefined
    let disposeKeys: (() => void) | undefined
    let watching: ReturnType<typeof setInterval> | undefined

    /**
     * Threads are kept on disk, one file each, keyed by the branch they are about.
     *
     * A review is about the *work*, not the conversation: you read a branch, leave notes, the agent
     * answers them, and somewhere in the middle you may well start a new chat. That should no more
     * lose your review than it loses your branch — and a half-finished review is a half-finished job,
     * not a piece of interface state to throw away on exit.
     */
    let persistence = createPersistence(
      reviewPaths(api.state.path.worktree || api.state.path.directory, api.state.vcs?.branch),
    )

    /** Saves one thread, and says nothing if it cannot: a review that will not persist still works. */
    const keep = (id: string | undefined) => {
      if (!id) return
      const thread = surface.review.threads.find((each) => each.id === id)
      if (thread) void persistence.save(thread).catch(() => {})
    }

    const viewport = () => ({
      width: frameBounds(surface.variant, { width: api.renderer.width, height: api.renderer.height }).width,
      height: api.renderer.height - 2,
    })
    /** Where the file list starts on screen, and how many rows of it there are. */
    const listTop = () => (panel?.y ?? 0) + 1 + HEADER_ROWS
    const listHeight = () => Math.max(1, (panel?.height ?? 20) - 2 - HEADER_ROWS - FOOTER_ROWS)

    const queries = createQueries(api, surface, store)

    const { guard, notice } = createTrouble({ api, surface, store })

    const { draw } = createPainter({
      api,
      surface,
      store,
      guard,
      queries,
      notice,
      boxes: () => ({ backdrop, panel, pool }),
    })

    /** The branch can change under us, and the review that belongs to it changes with it. */
    const refresh = async () => {
      persistence = createPersistence(
        reviewPaths(api.state.path.worktree || api.state.path.directory, api.state.vcs?.branch),
      )
      const [, threads] = await Promise.all([store.load(), persistence.load()])
      surface.review = { ...surface.review, threads }
      /** Land on something worth reading rather than on an empty pane. */
      const files = queries.files()
      if (!surface.view.file || !files.some((file) => file.path === surface.view.file)) {
        surface.view = { ...surface.view, ...(files[0] ? { file: files[0]?.path } : {}) }
      }
      draw()
    }

    /**
     * Threads change under the panel while the agent works, so they are re-read on a timer.
     *
     * **Nothing moves.** Threads change colour under you; the cursor and the scroll stay exactly where
     * you left them. A panel that reorders itself while your eye is on a line is worse than one that
     * is briefly stale — and a plugin cannot trust an event stream to be complete.
     */
    const reconcile = async () => {
      const threads = await persistence.load().catch(() => undefined)
      if (!threads) return
      if (JSON.stringify(threads) === JSON.stringify(surface.review.threads)) return
      surface.review = { ...surface.review, threads }
      draw()
    }

    const takeKeys = () => {
      if (disposeKeys) return
      disposeKeys = api.keymap.registerLayer(paneLayer(actions, guard))
    }
    const dropKeys = () => {
      disposeKeys?.()
      disposeKeys = undefined
    }

    const close = () => {
      surface.open = false
      clearInterval(watching)
      watching = undefined
      panel?.blur()
      dropKeys()
      draw()
      /** The prompt wants its cursor back, exactly where the host had it. */
      const at = api.renderer.getCursorState?.()
      if (at) api.renderer.setCursorPosition(at.x, at.y, true)
      else api.renderer.setCursorPosition(0, 0, true)
    }

    const show = () => {
      surface.open = true
      panel?.focus()
      takeKeys()
      draw()
      guard.task("refresh", refresh)
      clearInterval(watching)
      watching = setInterval(() => guard.task("reconcile", reconcile), 1_500)
    }

    const toggle = () => (surface.open ? close() : show())

    const cycle = () => {
      surface.variant = VARIANTS[(VARIANTS.indexOf(surface.variant) + 1) % VARIANTS.length] ?? "right"
      draw()
    }

    const actions = createActions({
      api,
      surface,
      store,
      guard,
      queries,
      draw,
      persistence: () => persistence,
      keep,
      listHeight,
      refresh: () => guard.task("refresh", refresh),
      takeKeys,
      dropKeys,
      close,
      cycle,
      reviewPackage: REVIEW_PACKAGE,
      sources: SOURCES,
    })

    const pointer = createPointer({
      surface,
      store,
      draw,
      panel: () => panel,
      listTop,
      listHeight,
      viewport,
    })

    api.keymap.registerLayer({
      commands: [
        {
          name: "cockpit.review.open",
          title: "Review: open, or close it",
          category: "Review",
          namespace: "palette",
          // One slash name for the bay: `/review` and `/diff` are the host's, and `/changes` loses the
          // fuzzy match to `/review`'s own description.
          slashName: "cockreview",
          run: () => guard.run("open", toggle),
        },
        {
          name: "cockpit.review.place",
          title: "Review: right pane, or full screen",
          category: "Review",
          namespace: "palette",
          run: () => guard.run("place", cycle),
        },
        {
          name: "cockpit.review.hide",
          title: "Review: close",
          category: "Review",
          namespace: "palette",
          run: () => guard.run("hide", close),
        },
      ],
      bindings: keys.gather("cockpit", Object.keys(DEFAULT_KEYS)),
    })

    api.slots.register({
      order: SLOT_ORDER,
      slots: {
        /**
         * Mounted once, hidden, and driven by assignment from here on. The slot function is called once
         * for its element — and so is everything it returns, props included.
         */
        app_bottom() {
          return (
            <Overlay
              api={api}
              onDismiss={() => {
                // Clicking off the panel dismisses it; at full width there is no "off" to click.
                if (surface.variant !== "full") close()
              }}
              onClick={(x, y) => {
                metrics.count("mouse")
                guard.run("click", () => pointer.clickAt(x, y))
              }}
              onScroll={(x, delta) => {
                metrics.count("mouse")
                guard.run("scroll", () => pointer.scrollAt(x, delta))
              }}
              onReady={({ backdrop: back, panel: front, lines }) => {
                backdrop = back
                panel = front
                pool = createRowPool(lines)
                draw()
              }}
            />
          )
        },
      },
    })
  }
}

const plugin: TuiPluginModule & { id: string } = {
  id: "opencode-cockpit.review",
  tui: createReviewTui(),
}
export default plugin
