/**
 * Getting the panel onto the screen, and doing it once per turn.
 *
 * Two platform facts shape everything here. A slot's tree is read exactly once, so the panel is driven
 * by *assignment* to renderables rather than by rendering — and a terminal hands a fast scroll over as
 * a burst of key events in a single read, so a paint per event means the screen falls further behind
 * the faster you move.
 */

import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BoxRenderable } from "@opentui/core"
import type { Guard } from "../../core/guard.ts"
import { metrics } from "../../core/perf.ts"
import { frameBounds } from "../../core/view/frame.ts"
import { layout } from "../../core/view/layout.ts"
import { statsRuns } from "../../core/view/stats.ts"
import type { Store } from "../data/changes.ts"
import type { RowPool } from "../view/pool.ts"
import type { Queries } from "./queries.ts"
import type { Surface } from "./surface.ts"

/** The renderables the panel was handed at mount, which may not exist yet. */
export interface Boxes {
  backdrop?: BoxRenderable
  panel?: BoxRenderable
  pool?: RowPool
}

export interface PaintDeps {
  api: TuiPluginApi
  surface: Surface
  store: Store
  guard: Guard
  queries: Queries
  /** What went wrong recently, if anything, for the footer to say so. */
  notice: () => string | undefined
  boxes: () => Boxes
}

export interface Painter {
  /** Asks for a paint. Several asks in one turn are one paint, of the state the turn ended on. */
  draw: () => void
}

export function createPainter(deps: PaintDeps): Painter {
  const { api, surface, store, guard, queries } = deps

  /** Everything on screen, recomputed and pushed onto the boxes. Called through `draw`, never directly. */
  const paint = () => {
    const { backdrop, panel, pool } = deps.boxes()
    if (!backdrop || !panel) return
    const screen = { width: api.renderer.width, height: api.renderer.height }
    const frame = frameBounds(surface.variant, screen)

    backdrop.width = screen.width
    backdrop.height = surface.open ? screen.height : 0
    backdrop.visible = surface.open

    panel.width = frame.width
    panel.height = surface.open ? screen.height : 0
    /**
     * No border, and no title.
     *
     * The pane is a surface, not a frame: the rule under the header and the dimming of the inactive
     * half already say where everything is. The header row inside says what a title would, and saying
     * it twice reads as a bug.
     */
    panel.title = ""

    if (!surface.open) {
      pool?.clear()
      api.renderer.requestRender()
      return
    }

    /**
     * Hide the terminal's own cursor while the review is up, *after* the host has drawn.
     *
     * That blue block over the file list is the real cursor, still parked in the prompt underneath. A
     * terminal draws its cursor itself, above every cell, so no z-index could cover it. Hiding it
     * during our draw is not enough either: the host paints its prompt afterwards and puts the cursor
     * back, so the last word has to be ours.
     */
    setTimeout(() => {
      if (surface.open) api.renderer.setCursorPosition(0, 0, false)
    }, 0)

    const trouble = deps.notice()
    const thread = queries.hereThreadId()
    const rows = layout(
      store.current().changes,
      surface.review,
      {
        ...surface.view,
        label: queries.label(),
        ...(thread ? { thread } : {}),
        /** Trouble outranks the numbers; both outrank the keys, and the footer stays two rows. */
        ...(trouble
          ? { notice: trouble }
          : surface.showStats
            ? { stats: statsRuns(metrics.snapshot()) }
            : {}),
      },
      { width: frame.width, height: screen.height - 2 },
    )
    pool?.draw(rows, api.theme.current)
    api.renderer.requestRender()
  }

  let scheduled = false
  return {
    draw() {
      if (scheduled) {
        metrics.count("coalesced")
        return
      }
      scheduled = true
      /**
       * A macrotask, not a microtask: a paint that asked for another paint would re-queue inside the
       * same drain and starve the event loop — a freeze that reads exactly like a crash. A timeout
       * collapses a burst just as well and always gives the loop its turn back.
       */
      setTimeout(() => {
        scheduled = false
        metrics.count("paints")
        metrics.time("paint", () => {
          guard.run("paint", paint)
        })
      }, 0)
    },
  }
}
