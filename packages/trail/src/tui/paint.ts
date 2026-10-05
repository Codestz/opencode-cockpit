/**
 * Painting: the sidebar block's rows and `/trail`'s, from the trail as it is now, into the signals the
 * views draw. `draw` asks for a paint and folds every change in one turn into it; `paint` paints now.
 *
 * What it paints from lives in `Live` and `DialogState`, which the rest of the interface changes.
 */

import type { Host } from "@opencode-cockpit/client/host"
import type { Log } from "@opencode-cockpit/client/log"
import { blockWidth } from "@opencode-cockpit/client/sidebar"
import type { BoxRenderable } from "@opentui/core"
import { type Accessor, createSignal } from "solid-js"
import type { TrailSettings } from "../core/config.ts"
import { arrange, conversationThings } from "../core/model.ts"
import type { State } from "../core/store.ts"
import { type DialogView, dialogRows, type Tab } from "../core/view/dialog.ts"
import type { Row } from "../core/view/rows.ts"
import { type SidebarView, sidebarRows } from "../core/view/sidebar.ts"

/** The host's dialog: as wide as xlarge allows (Shell's console measured it). */
const DIALOG_COLUMNS = 116

/** What the interface knows now, shared by everything that reads or changes it. */
export interface Live {
  state: State
  /** The conversation — the root session — on screen. */
  root: string | undefined
  /** Something you should know about: drawn as a `!` row whatever else the block says. */
  trouble: string | undefined
  /** Not remembered across restarts: remembered UI state makes a command look dead (gotchas.md). */
  inSidebar: boolean
  /** Live conversation titles from the host's list, over the ones written down when recording. */
  readonly titles: Map<string, string>
}

/** `/trail`: which tab, what is under the cursor, and the search. */
export interface DialogState {
  open: boolean
  tab: Tab
  selected: string | undefined
  query: string
  searching: boolean
}

export interface Painter {
  readonly sidebarLines: Accessor<readonly Row[]>
  readonly dialogLines: Accessor<readonly Row[]>
  /** The block the host laid out: its width is what the rows are cut to. */
  setBlock(box: BoxRenderable): void
  /** The sidebar was laid out, or resized, since the rows were drawn. */
  resized(): boolean
  paint(): void
  draw(): void
  sidebarView(): SidebarView
  /** What `/trail` shows, while it is open. */
  shown(): DialogView | undefined
}

export function createPainter(input: {
  api: Host
  log: Log
  settings: TrailSettings
  notices: readonly string[]
  project: string
  live: Live
  dialog: DialogState
}): Painter {
  const { api, log, settings, notices, project, live, dialog } = input
  const [sidebarLines, setLines] = createSignal<readonly Row[]>([])
  const [dialogLines, setDialogLines] = createSignal<readonly Row[]>([])
  let block: BoxRenderable | undefined
  let drawnAt = 0
  let said = ""
  let sidebarView: SidebarView = { rows: [], hits: [] }
  let shown: DialogView | undefined
  const sidebarWidth = () => blockWidth(block, api.renderer.width)

  const paint = () => {
    drawnAt = sidebarWidth()
    const now = Date.now()
    const warnings = [...notices, ...(live.trouble ? [live.trouble] : [])]
    const mine = arrange(live.root ? conversationThings(live.state, live.root) : [])
    /** Hidden, the block says nothing — except a notice or trouble: a failure always speaks. */
    sidebarView = live.inSidebar
      ? sidebarRows({
          width: drawnAt,
          arranged: mine,
          now,
          limit: settings.sidebarRows,
          hideWhenEmpty: settings.hideWhenEmpty,
          notices: warnings,
        })
      : sidebarRows({
          width: drawnAt,
          arranged: arrange([]),
          now,
          limit: 0,
          hideWhenEmpty: true,
          notices: warnings,
        })
    /** Only when they changed: new rows rebuild every line of the block. */
    const text = JSON.stringify(sidebarView.rows)
    if (text !== said) {
      said = text
      setLines(sidebarView.rows)
    }
    if (dialog.open) {
      const height = api.renderer.height
      shown = dialogRows({
        width: Math.max(40, Math.min(DIALOG_COLUMNS, api.renderer.width - 2)),
        height: Math.max(11, height - Math.floor(height / 4) * 2),
        tab: dialog.tab,
        state: live.state,
        session: live.root ?? "",
        now,
        project,
        ...(dialog.selected !== undefined ? { selected: dialog.selected } : {}),
        query: dialog.query,
        searching: dialog.searching,
      })
      dialog.selected = shown.item?.key
      setDialogLines(shown.rows)
    }
    api.renderer.requestRender()
  }
  /** Several changes in one turn are one paint (Shell's painter). */
  let scheduled = false
  const draw = () => {
    if (scheduled) return
    scheduled = true
    setTimeout(() => {
      scheduled = false
      try {
        paint()
      } catch (error) {
        log.error("paint failed", { error })
      }
    }, 0)
  }

  return {
    sidebarLines,
    dialogLines,
    setBlock: (box) => {
      block = box
    },
    resized: () => sidebarWidth() !== drawnAt,
    paint,
    draw,
    sidebarView: () => sidebarView,
    shown: () => shown,
  }
}
