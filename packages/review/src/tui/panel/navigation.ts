/**
 * Moving through the panel: the cursor in the file list and in the diff, scrolling, panning sideways,
 * and which pane `j` is talking to. The verbs that act on a thread lean on the same view of the rows
 * (`streamNow`, `listState`) and on `follow`, so they come from here too.
 */

import { filesElsewhere } from "../../core/model/review.ts"
import { mostShift } from "../../core/view/diff.ts"
import { streamWidth } from "../../core/view/layout.ts"
import { keepCursorVisible, navigableRows } from "../../core/view/list.ts"
import {
  cursorRow,
  segmentAt,
  stopsOf,
  streamOf,
  streamScroll,
  streamWindow,
} from "../../core/view/stream.ts"
import type { ActionDeps } from "./actions.ts"

export interface Navigation {
  /** The view the list is drawn from. */
  listState: () => Parameters<typeof navigableRows>[1]
  width: () => number
  streamNow: () => ReturnType<typeof streamOf>
  follow: () => void
  move: (delta: number) => void
  scroll: (delta: number) => void
  pan: (delta: number) => void
  toFiles: () => void
  swap: () => void
}

export function createNavigation(deps: ActionDeps): Navigation {
  const { surface, store, draw, listHeight } = deps

  /**
   * Movement follows the rows on screen, not the change set's own file order.
   *
   * Those are two different orders — the screen shows a grouped tree, the change set is however git
   * listed things — and driving the cursor from the second while looking at the first is why it
   * appeared to jump at random.
   */
  /** The view the list is actually drawn from, including files that have comments but no diff. */
  const listState = () => ({
    ...surface.view,
    elsewhere: filesElsewhere(surface.review, store.current().changes),
  })

  const moveFiles = (delta: number) => {
    const rows = navigableRows(store.current().changes, listState())
    if (rows.length === 0) return
    const at = surface.view.cursor ? rows.findIndex((row) => row.path === surface.view.cursor) : 0
    const next = rows[Math.max(0, Math.min(rows.length - 1, (at < 0 ? 0 : at) + delta))]
    if (!next) return
    surface.view = { ...surface.view, cursor: next.path }
    if (next.kind === "file")
      surface.view = {
        ...surface.view,
        file: next.path,
        scroll: undefined,
        line: undefined,
        anchor: undefined,
      }
    surface.view = {
      ...surface.view,
      listOffset: keepCursorVisible(store.current().changes, listState(), listHeight()),
    }
    draw()
  }

  /** The stream as the paint will draw it, for the keys to reason about. */
  const width = () => streamWidth(deps.viewport(), store.current().changes)
  const streamNow = () => streamOf(store.current().changes, surface.review, listState(), width())

  /**
   * Scrolls just enough to keep the cursor in view, and keeps the file list pointing at its file.
   *
   * One row of margin at the top, because the pinned heading covers the first row of the pane: a
   * cursor on that row would be hidden under the name of its own file.
   */
  const follow = () => {
    const stream = streamNow()
    const height = listHeight()
    const scroll = streamScroll(stream, surface.view, height)
    const row = cursorRow(stream, surface.review, surface.view, width())
    let next = scroll
    if (row !== undefined) {
      const top = surface.view.line === undefined ? row : row - 1
      if (top < scroll) next = top
      else if (row > scroll + height - 3) next = row - height + 3
    }
    surface.view = { ...surface.view, scroll: Math.max(0, next), cursor: surface.view.file }
    surface.view = {
      ...surface.view,
      listOffset: keepCursorVisible(store.current().changes, listState(), listHeight()),
    }
  }

  /**
   * In the diff, the cursor walks the stream: a file's heading, then its lines, then the next file's
   * heading. A folded file is one stop — its heading — so viewed files are stepped over in one press.
   */
  const moveLines = (delta: number) => {
    const { segments } = streamNow()
    if (segments.length === 0) return
    let index = Math.max(
      0,
      segments.findIndex((segment) => segment.path === surface.view.file),
    )
    let segment = segments[index]
    if (!segment) return
    let stops = stopsOf(segment, surface.review, surface.view, width())
    let at = Math.max(0, stops.indexOf(surface.view.line))
    const step = Math.sign(delta)
    for (let left = Math.abs(delta); left > 0; left--) {
      if (at + step >= 0 && at + step < stops.length) {
        at += step
        continue
      }
      const neighbour = segments[index + step]
      if (!neighbour) break
      index += step
      segment = neighbour
      stops = stopsOf(segment, surface.review, surface.view, width())
      at = step > 0 ? 0 : stops.length - 1
    }
    const moved = segment.path !== surface.view.file
    surface.view = {
      ...surface.view,
      file: segment.path,
      line: stops[at],
      thread: undefined,
      /** A selection is inside one file: leaving the file lets go of it. */
      ...(moved ? { anchor: undefined } : {}),
    }
    follow()
    draw()
  }

  const move = (delta: number) => (surface.view.pane === "diff" ? moveLines(delta) : moveFiles(delta))

  /**
   * Scrolling moves the view, and the cursor only if the view leaves it behind — then it lands on the
   * first thing in sight, so the next `j` carries on from what you are looking at rather than jumping
   * back to where you were.
   */
  /**
   * Sideways through the code of the file under the cursor, as far as its longest line. A line that
   * ran past the pane used to end in "…" with no way to read the rest.
   */
  const pan = (delta: number) => {
    const file = store.current().changes.files.find((change) => change.path === surface.view.file)
    const most = mostShift(file, width())
    const shift = Math.max(0, Math.min(most, (surface.view.shift ?? 0) + delta))
    if (shift === (surface.view.shift ?? 0)) return
    surface.view = { ...surface.view, shift, pane: "diff" }
    draw()
  }

  const scroll = (delta: number) => {
    const stream = streamNow()
    const height = listHeight()
    const next = Math.max(0, streamScroll(stream, surface.view, height) + delta)
    surface.view = {
      ...surface.view,
      scroll: streamScroll(stream, { ...surface.view, scroll: next }, height),
    }
    const at = surface.view.scroll ?? 0
    const row = cursorRow(stream, surface.review, surface.view, width())
    if (row === undefined || row < at || row >= at + height) {
      const shown = streamWindow(store.current().changes, surface.review, listState(), width(), height)
      /** Past the pinned heading, onto the first line of code in sight, if there is one. */
      const landing = shown.slice(1).find((each) => each.line !== undefined || each.header) ?? shown[0]
      const file = landing?.file ?? segmentAt(stream, at)?.path
      if (file) {
        surface.view = {
          ...surface.view,
          file,
          cursor: file,
          line: landing?.header ? undefined : landing?.line,
          anchor: undefined,
        }
      }
    }
    /** The file list follows the diff: the file you are reading stays in sight on the left too. */
    surface.view = {
      ...surface.view,
      cursor: surface.view.file,
      listOffset: keepCursorVisible(
        store.current().changes,
        { ...listState(), cursor: surface.view.file },
        height,
      ),
    }
    draw()
  }

  /**
   * Out of the diff and back to the list.
   *
   * `enter` takes you into a file, so something has to take you out, and `tab` alone is a thing you
   * have to be told. `h` and `left` are where a hand already is after `j`/`k`.
   */
  const toFiles = () => {
    surface.view = { ...surface.view, pane: "files", anchor: undefined }
    draw()
  }

  /** Two panes, one keyboard: `tab` says which one `j` is talking to. */
  const swap = () => {
    surface.view = { ...surface.view, pane: surface.view.pane === "diff" ? "files" : "diff" }
    if (surface.view.pane === "diff" && surface.view.file === undefined)
      surface.view = { ...surface.view, file: streamNow().segments[0]?.path, scroll: undefined }
    draw()
  }

  return { listState, width, streamNow, follow, move, scroll, pan, toFiles, swap }
}
