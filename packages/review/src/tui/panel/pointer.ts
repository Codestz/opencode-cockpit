/**
 * What a click and a wheel mean.
 *
 * Rows are a fixed height, so the row under the pointer is arithmetic rather than hit-testing: the
 * pointer's row, less where the list starts on screen. Which half it landed in decides what it means —
 * a click that quietly did the other pane's thing would be the wrong thing happening somewhere you
 * were not looking.
 */

import type { BoxRenderable } from "@opentui/core"
import { splitColumns } from "../../core/view/geometry.ts"
import { visibleDiffRows } from "../../core/view/layout.ts"
import { listScroll, navigableRows } from "../../core/view/list.ts"
import type { Viewport } from "../../core/view/state.ts"
import type { Store } from "../data/changes.ts"
import type { Surface } from "./surface.ts"

export interface PointerDeps {
  surface: Surface
  store: Store
  draw: () => void
  panel: () => BoxRenderable | undefined
  /** The screen row the file list starts on. */
  listTop: () => number
  listHeight: () => number
  viewport: () => Viewport
}

export interface Pointer {
  clickAt: (x: number, y: number) => void
  scrollAt: (x: number, delta: number) => void
}

export function createPointer(deps: PointerDeps): Pointer {
  const { surface, store, draw } = deps

  /** Whether a column belongs to the file list, which is also how the wheel decides what it scrolls. */
  const overList = (x: number, panel: BoxRenderable): boolean => {
    const columns = splitColumns(panel.width)
    return columns.list > 0 && x <= panel.x + columns.list
  }

  return {
    clickAt(x, y) {
      const panel = deps.panel()
      if (!panel) return
      const row = y - deps.listTop()
      if (row < 0) return

      if (overList(x, panel)) {
        const rows = navigableRows(store.current().changes, surface.view)
        if (rows.length === 0) return
        const entry = rows[row + listScroll(store.current().changes, surface.view, deps.listHeight())]
        if (!entry) return
        surface.view = { ...surface.view, cursor: entry.path, pane: "files" }
        if (entry.kind === "file") {
          surface.view = { ...surface.view, file: entry.path, scroll: 0, line: undefined, anchor: undefined }
        } else {
          const collapsed = new Set(surface.view.collapsed ?? [])
          if (collapsed.has(entry.path)) collapsed.delete(entry.path)
          else collapsed.add(entry.path)
          surface.view = { ...surface.view, collapsed }
        }
        draw()
        return
      }

      const drawn = visibleDiffRows(
        store.current().changes,
        surface.review,
        { ...surface.view, pane: "diff" },
        deps.viewport(),
      )
      const at = drawn[row]
      const picked = at?.target?.startsWith("rv_") ? at.target : undefined
      const line = at?.line
      /**
       * Clicking while a selection is open *extends* it, so `v` then a click picks a range the way
       * dragging would — the anchor stays and the click becomes the moving end. A click on a hunk
       * header or a note is not a click on a line at all; it moves the pane, not the cursor.
       */
      const keepAnchor = surface.view.anchor !== undefined
      surface.view = {
        ...surface.view,
        pane: "diff",
        thread: picked,
        ...(line === undefined ? {} : { line, ...(keepAnchor ? {} : { anchor: undefined }) }),
      }
      draw()
    },

    /**
     * The wheel scrolls whichever pane it is over, and makes that pane the active one.
     *
     * Over the list it moves the view and leaves the cursor: the list follows the cursor, so moving
     * both would fight itself on the next keypress. Scrolling a pane is using it — otherwise the half
     * under your hand is the half drawn dimmed, which is the opposite of what dimming is for.
     */
    scrollAt(x, delta) {
      const panel = deps.panel()
      if (!panel) return
      if (overList(x, panel)) {
        surface.view = {
          ...surface.view,
          pane: "files",
          listOffset: Math.max(0, (surface.view.listOffset ?? 0) + delta),
        }
      } else {
        surface.view = {
          ...surface.view,
          pane: "diff",
          scroll: Math.max(0, (surface.view.scroll ?? 0) + delta),
        }
      }
      draw()
    },
  }
}
