/**
 * Painting: the sidebar block's lines and the pane's rows, from the model as it is now. `draw` asks
 * for a paint and folds every ask in one turn into it; `paint` paints now. The pane is drawn into
 * the overlay's row pool, which the host hands over once it is laid out (`attach`).
 */

import type { Host } from "@opencode-cockpit/client/host"
import type { Log } from "@opencode-cockpit/client/log"
import { blockWidth, measureBlock } from "@opencode-cockpit/client/sidebar"
import type { BoxRenderable, TextRenderable } from "@opentui/core"
import { type Accessor, createSignal } from "solid-js"
import type { SubagentsConfig } from "../core/config.ts"
import type { Model, Node, Session } from "../core/model/model.ts"
import { createScreenCache, type Screen, screenRows } from "../core/view/screen.ts"
import { type SidebarLine, sidebarLines } from "../core/view/sidebar.ts"
import { createRowPool, type RowPool, solidSurface } from "./render.ts"
import type { Surface } from "./surface.ts"

export interface Painter {
  readonly lines: Accessor<readonly SidebarLine[]>
  /** The block the host laid out: its width is what the rows are cut to. */
  setBlock(box: BoxRenderable): void
  /** The overlay, once the host has laid it out: the pane draws into it from then on. */
  attach(parts: { backdrop: BoxRenderable; panel: BoxRenderable; lines: TextRenderable[] }): void
  /** The pane takes focus from the prompt, or gives it back. */
  focus(): void
  blur(): void
  /** The sidebar was laid out, or resized, since the rows were drawn. */
  resized(): boolean
  /** A finished nested subagent has yet to leave: the clock has to keep drawing until it does. */
  fading(): boolean
  /** The spinners' next frame. */
  tick(): void
  paint(): void
  draw(): void
  /** What the pane shows now, as last painted: what keys and clicks act on. */
  shown(): Screen | undefined
}

export function createPainter(input: {
  api: Host
  log: Log
  options: SubagentsConfig
  /** Said in the block for the session, one `!` row each, until the file is fixed. */
  warnings: readonly string[]
  model: Model
  surface: Surface
  yours: ReadonlySet<string>
  nodes: () => Node[]
  opened: () => Session | undefined
  busy: (session: Session) => boolean
}): Painter {
  const { api, log, options, warnings, model, surface, yours, nodes, opened, busy } = input
  let frame = 0
  let backdrop: BoxRenderable | undefined
  let panel: BoxRenderable | undefined
  let pool: RowPool | undefined
  let shown: Screen | undefined
  /** Each item's rows between paints: a scroll or a tick redraws only what changed. */
  const cache = createScreenCache()
  const [lines, setLines] = createSignal<readonly SidebarLine[]>([])
  let block: BoxRenderable | undefined
  let drawnAt = 0
  let sidebarSaid = ""
  /**
   * The width the sidebar gave the block, once laid out; a guess before that. Guessed, the rows ran
   * past the edge and were clipped: "3 done" drew as "3 d".
   */
  let told = 0
  const sidebarWidth = () => {
    const { measured, own, parent } = measureBlock(block)
    if (measured !== told) {
      told = measured
      log.debug("sidebar width", { measured, own, parent, window: api.renderer.width })
    }
    return blockWidth(block, api.renderer.width)
  }
  /** Half the window, but never so narrow a call's arguments cannot be read. */
  const paneWidth = () => {
    const width = api.renderer.width
    return surface.full ? width : Math.min(width, Math.max(72, Math.floor(width / 2)))
  }

  /** Milliseconds a finished nested subagent stays in the sidebar; undefined keeps it. */
  const nested = options.hideNestedAfterSeconds ?? 30
  const fadeAfter = nested >= 0 ? nested * 1000 : undefined
  const fading = () =>
    fadeAfter !== undefined &&
    nodes().some(
      ({ session, depth }) =>
        depth >= 1 &&
        (session.status === "done" || session.status === "failed") &&
        Date.now() - (session.ended ?? 0) < fadeAfter + 2000,
    )

  const paint = () => {
    const now = Date.now()
    const list = nodes()
    drawnAt = sidebarWidth()
    const after = options.hideFinishedAfterMinutes
    const listed =
      typeof after === "number" && after >= 0
        ? list.filter(
            ({ session }) =>
              !(session.status === "done" || session.status === "failed") ||
              now - (session.ended ?? now) < after * 60_000,
          )
        : list
    const next = sidebarLines({
      nodes: listed,
      width: drawnAt,
      now,
      frame,
      limit: options.sidebarRows,
      ...(fadeAfter !== undefined ? { fadeAfter } : {}),
      hideWhenEmpty: options.hideWhenEmpty,
      notices: warnings,
    })
    /** Only when they changed: new rows rebuild every line of the block, and a scroll is many paints. */
    const said = JSON.stringify(next)
    if (said !== sidebarSaid) {
      sidebarSaid = said
      setLines(next)
    }
    const session = opened()
    if (backdrop && panel && pool) {
      const show = Boolean(session)
      const height = api.renderer.height
      backdrop.width = api.renderer.width
      backdrop.height = show ? height : 0
      backdrop.visible = show
      panel.backgroundColor = solidSurface(api.theme.current)
      panel.width = paneWidth()
      panel.height = show ? height : 0
      if (session && show) {
        const launcher = session.parentID ? model.sessions.get(session.parentID)?.agent : undefined
        const started = performance.now()
        const screen = screenRows({
          cache,
          session,
          nodes: list,
          ...(launcher ? { launcher } : {}),
          width: paneWidth(),
          height,
          now,
          frame,
          ...(surface.top !== undefined ? { top: surface.top } : {}),
          ...(surface.selected ? { selected: surface.selected } : {}),
          open: surface.opened,
          closed: surface.closed,
          thinking: surface.thinking,
          details: surface.details,
          keys: surface.keys === true,
          whole: surface.whole,
          yours: (entry) => yours.has(`${session.id}:${entry.text}`),
          reveal: surface.reveal === true,
          ...(surface.draft !== undefined ? { input: { draft: surface.draft, busy: busy(session) } } : {}),
          ...(surface.notice ? { notice: surface.notice } : {}),
        })
        /** Scrolled back to the end: follow the run again. */
        /** Where the reveal left the view is where it stays. */
        if (surface.reveal && surface.top !== undefined) surface.top = screen.top
        surface.reveal = false
        if (surface.top !== undefined && screen.top >= screen.most && !surface.selected)
          surface.top = undefined
        shown = screen
        pool.draw(screen.rows, api.theme.current)
        const took = performance.now() - started
        /** A paint past a frame is worth knowing about; the run's size says why. */
        if (took > 16) log.debug("slow paint", { ms: Math.round(took), entries: session.entries.length })
        /** The prompt's cursor would otherwise blink through the pane, as it did over Review. */
        setTimeout(() => {
          if (surface.open) api.renderer.setCursorPosition(0, 0, false)
        }, 0)
      } else {
        shown = undefined
        pool.clear()
      }
    }
    api.renderer.requestRender()
  }
  /** Several asks in one turn are one paint, of the state the turn ended on (Shell's painter). */
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
    lines,
    setBlock: (box) => {
      block = box
    },
    attach: (parts) => {
      backdrop = parts.backdrop
      panel = parts.panel
      pool = createRowPool(parts.lines)
      draw()
    },
    focus: () => backdrop?.focus(),
    blur: () => backdrop?.blur(),
    resized: () => sidebarWidth() !== drawnAt,
    fading,
    tick: () => {
      frame++
    },
    paint,
    draw,
    shown: () => shown,
  }
}
