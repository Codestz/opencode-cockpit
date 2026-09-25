import type { Host } from "@opencode-cockpit/client/host"
import type { BoxRenderable } from "@opentui/core"
import { bodyHeight, bodyRoom, type ConsoleInput, consoleRows } from "../lib/console.ts"
import { order } from "../lib/view.ts"
import type { ShellStore } from "../state/store.ts"
import { type RowPool, solidSurface } from "../view/pool.ts"
import type { Feed } from "./feed.ts"
import type { Surface } from "./surface.ts"

/** The renderables full screen's slot handed up at mount, which may not exist yet. */
export interface Boxes {
  backdrop?: BoxRenderable
  pool?: RowPool
}

export interface PaintDeps {
  api: Host
  store: ShellStore
  surface: Surface
  feed: Feed
  colors: boolean
  boxes: () => Boxes
  /** The dialog redraws itself when told; full screen is drawn here. */
  dialogChanged: () => void
}

export interface Size {
  width: number
  height: number
  /** Fill the height (full screen) or shrink to the content (the dialog). */
  fill: boolean
}

export interface Painter {
  /** Asks for a paint. Several asks in one turn are one paint, of the state the turn ended on. */
  draw: () => void
  /** The console's rows at its current size — what the dialog renders. */
  rows: () => ReturnType<typeof consoleRows>
  /** The size the console has right now. */
  size: () => Size
  /** Body rows at the current size, as drawn. */
  body: () => number
  /** Rows the body has room for at the current size — what a running program is sized to. */
  room: () => number
  /** How far the view can scroll up, for the keys to clamp against. */
  most: () => number
}

/** The host's dialog: a quarter down, as wide as xlarge allows, ending as far from the bottom. */
const DIALOG_COLUMNS = 116

/** Review's `panel/paint.ts`, for Shell: one set of rows, at whichever size the console has. */
export function createPainter(deps: PaintDeps): Painter {
  const { api, store, surface, feed } = deps

  const size = (): Size => {
    const width = api.renderer.width
    const height = api.renderer.height
    if (surface.full) return { width, height, fill: true }
    return {
      width: Math.max(40, Math.min(DIALOG_COLUMNS, width - 2)),
      height: Math.max(12, height - Math.floor(height / 4) * 2),
      fill: false,
    }
  }

  const input = (): ConsoleInput => {
    const shell = store.selected()
    const list = order(store.shells())
    const at = list.findIndex((each) => each.id === shell?.id)
    const screen = feed.screen()
    const { width, height, fill } = size()
    return {
      ...(shell ? { shell } : {}),
      now: store.now(),
      frame: store.frame(),
      project: store.project(),
      ...(screen ? { screen } : {}),
      log: surface.log,
      view: surface.view,
      up: surface.up,
      typing: surface.typing,
      colors: deps.colors,
      filter: surface.filter,
      searching: surface.searching,
      draft: surface.draft,
      ...(surface.notice ? { notice: surface.notice } : {}),
      keys: {
        shell: Boolean(shell),
        running: shell?.status === "running",
        view: surface.view,
        filtered: Boolean(surface.filter),
        count: list.length,
        scope: store.scope(),
        finished: list.filter((each) => each.status !== "running").length,
        full: surface.full,
      },
      position: list.length > 1 && at >= 0 ? `${at + 1}/${list.length}` : "",
      width,
      height,
      fill,
    }
  }

  const length = () =>
    surface.view === "log"
      ? surface.log.length
      : (feed.screen()?.styled?.length ?? (feed.screen()?.text ?? "").split("\n").length)
  const body = () => bodyHeight(input())
  const room = () => bodyRoom(input())
  const most = () => Math.max(0, length() - body())
  const rows = () => consoleRows({ ...input(), up: Math.min(surface.up, most()) })

  const paint = () => {
    const { backdrop, pool } = deps.boxes()
    const full = surface.open && surface.full
    if (backdrop && pool) {
      /** Opaque whatever the theme says, or the conversation shows through (transparent themes). */
      backdrop.backgroundColor = solidSurface(api.theme.current)
      backdrop.width = api.renderer.width
      backdrop.height = full ? api.renderer.height : 0
      backdrop.visible = full
      if (full) pool.draw(rows(), api.theme.current)
      else pool.clear()
    }
    if (surface.open && !surface.full) deps.dialogChanged()
    /** The prompt's cursor would otherwise blink through the console, as it did over Review. */
    if (full)
      setTimeout(() => {
        if (surface.open && surface.full) api.renderer.setCursorPosition(0, 0, false)
      }, 0)
  }

  let scheduled = false
  return {
    rows,
    size,
    body,
    room,
    most,
    draw() {
      if (scheduled) return
      scheduled = true
      /** A macrotask, as in Review: a burst of keys is one paint, and the loop always gets its turn. */
      setTimeout(() => {
        scheduled = false
        paint()
      }, 0)
    },
  }
}
