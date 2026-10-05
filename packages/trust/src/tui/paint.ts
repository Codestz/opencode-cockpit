/**
 * Painting: the sidebar block's rows and the dialog's, from the engine as it is now, into the signals
 * the views draw. `draw` asks for a paint and folds every change in one turn into it; `paint` paints
 * now.
 *
 * What it paints from lives in `Live` and `DialogState`, which the rest of the interface changes.
 */

import { warnRows } from "@opencode-cockpit/client/design"
import type { Host } from "@opencode-cockpit/client/host"
import type { Log } from "@opencode-cockpit/client/log"
import { noticeText, type SettingsNotice } from "@opencode-cockpit/client/settings"
import { blockWidth } from "@opencode-cockpit/client/sidebar"
import type { BoxRenderable } from "@opentui/core"
import { type Accessor, createSignal } from "solid-js"
import type { TrustSettings } from "../core/config.ts"
import type { Engine } from "../core/engine.ts"
import { type ActivityView, activityRows } from "../core/view/activity.ts"
import { type ExplorerView, explorerRows } from "../core/view/explorer.ts"
import type { Row, Tone } from "../core/view/rows.ts"
import { sidebarRows, tally } from "../core/view/sidebar.ts"

/** The host's dialog: as wide as xlarge allows (Shell's console measured it). */
const DIALOG_COLUMNS = 116

/** What the interface knows now, shared by everything that reads or changes it. */
export interface Live {
  /** Something you should know about. The sidebar says it whatever else it has to say. */
  trouble: string | undefined
  /**
   * Off by default (core/config.ts): the sidebar is crowded, and Trust answers the same without it.
   * The palette flips it for the session; config decides where it starts. Not remembered across
   * restarts — remembered UI state makes a command look dead (docs/opencode/gotchas.md).
   */
  inSidebar: boolean
}

/**
 * The dialog: the activity `/trust` opens on, and the ledger behind `l`. Each keeps its own cursor
 * by key, so a rule revoked or a family folded moves the rows about, not the cursor.
 */
export interface DialogState {
  open: boolean
  view: "activity" | "ledger"
  /** `?`: every key, in the body's place. */
  keys: boolean
  notice: { text: string; tone: Tone } | undefined
  activity: string | undefined
  node: string | undefined
  /** Families opened, and those whose tail is listed too; every family starts folded. */
  opened: Set<string>
  full: Set<string>
  filter: string
  /** `/` pressed: the text typed so far, until enter or esc. */
  typing: string | undefined
  /** `tab` into the card: the focused button. */
  button: number | undefined
}

export const closedDialog = (): DialogState => ({
  open: false,
  view: "activity",
  keys: false,
  notice: undefined,
  activity: undefined,
  node: undefined,
  opened: new Set(),
  full: new Set(),
  filter: "",
  typing: undefined,
  button: undefined,
})

/** What was drawn last: actions and clicks act on what is on screen. */
export interface Shown {
  activity?: ActivityView
  ledger?: ExplorerView
}

export interface Painter {
  readonly sidebarLines: Accessor<readonly Row[]>
  readonly dialogRows: Accessor<readonly Row[]>
  /** The block the host laid out: its width is what the rows are cut to. */
  setBlock(box: BoxRenderable): void
  /** The sidebar was laid out, or resized, since the rows were drawn. */
  resized(): boolean
  paint(): void
  draw(): void
  shown(): Shown
  /** What the views read the ledger with: the state, the settings, the time, the history. */
  reading(): { state: Engine["state"]; settings: TrustSettings; now: number; history: Engine["history"] }
}

export function createPainter(input: {
  api: Host
  log: Log
  engine: Engine
  settings: TrustSettings
  notices: readonly SettingsNotice[]
  project: string
  live: Live
  dialog: DialogState
}): Painter {
  const { api, log, engine, settings, notices, project, live, dialog } = input
  const [sidebarLines, setLines] = createSignal<readonly Row[]>([])
  const [dialogRows, setDialogRows] = createSignal<readonly Row[]>([])
  let block: BoxRenderable | undefined
  let drawnAt = 0
  let said = ""
  let shown: Shown = {}
  const sidebarWidth = () => blockWidth(block, api.renderer.width)
  const reading = () => ({ state: engine.state, settings, now: Date.now(), history: engine.history })

  const paint = () => {
    drawnAt = sidebarWidth()
    /**
     * A setting in Trust's section that is not read — a value of the wrong kind — is
     * a `!` row on top, for the session, until the file is fixed. Shown with the block hidden too:
     * like trouble, a setting that silently does nothing is what nobody would find otherwise.
     */
    const warned: Row[] = notices.flatMap((notice) => warnRows(noticeText(notice), drawnAt))
    /** Hidden, the block says nothing — except trouble: a failure always speaks. */
    const rows =
      !live.inSidebar && !live.trouble
        ? []
        : sidebarRows({
            width: drawnAt,
            recent: engine.recent(),
            count: engine.count(),
            pending: engine.pending(),
            state: engine.state,
            limit: settings.sidebarRows,
            shown: live.inSidebar,
            ...(live.inSidebar ? { project: tally(engine.state, settings, Date.now()) } : {}),
            ...(live.trouble ? { trouble: live.trouble } : {}),
          })
    const next = [...warned, ...rows]
    /** Only when they changed: new rows rebuild every line of the block. */
    const text = JSON.stringify(next)
    if (text !== said) {
      said = text
      setLines(next)
    }
    if (dialog.open) {
      const height = api.renderer.height
      const size = {
        width: Math.max(40, Math.min(DIALOG_COLUMNS, api.renderer.width - 2)),
        height: Math.max(11, height - Math.floor(height / 4) * 2),
        project,
        ...reading(),
        ...(dialog.notice ? { notice: dialog.notice } : {}),
        ...(dialog.keys ? { keys: true } : {}),
      }
      if (dialog.view === "activity") {
        const view = activityRows({
          ...size,
          ...(dialog.activity !== undefined ? { selected: dialog.activity } : {}),
        })
        dialog.activity = view.item?.key
        shown = { activity: view }
        setDialogRows(view.rows)
      } else {
        const view = explorerRows({
          ...size,
          open: dialog.opened,
          full: dialog.full,
          filter: dialog.filter,
          ...(dialog.node !== undefined ? { selected: dialog.node } : {}),
          ...(dialog.button !== undefined ? { focus: { button: dialog.button } } : {}),
          ...(dialog.typing !== undefined ? { typing: dialog.typing } : {}),
        })
        dialog.node = view.node?.key
        if (dialog.button !== undefined && view.buttons.length > 0)
          dialog.button = Math.min(dialog.button, view.buttons.length - 1)
        else dialog.button = undefined
        shown = { ledger: view }
        setDialogRows(view.rows)
      }
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
    dialogRows,
    setBlock: (box) => {
      block = box
    },
    resized: () => sidebarWidth() !== drawnAt,
    paint,
    draw,
    shown: () => shown,
    reading,
  }
}
