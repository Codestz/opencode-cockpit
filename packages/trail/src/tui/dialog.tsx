/** @jsxImportSource @opentui/solid */

/**
 * `/trail`: opening it on the host's dialog, its keys, and what each does to the row under the cursor
 * — open the page, go to the conversation, copy, remove, search.
 */

import type { Host, InterceptContext, Layer } from "@opencode-cockpit/client/host"
import type { Log } from "@opencode-cockpit/client/log"
import { markdownOf } from "../core/text.ts"
import type { Actions } from "./actions.ts"
import type { DialogState, Live, Painter } from "./paint.ts"
import type { Sessions } from "./source.ts"
import { Dialog } from "./view/dialog.tsx"

export const closedDialog = (): DialogState => ({
  open: false,
  tab: "this",
  selected: undefined,
  query: "",
  searching: false,
})

export interface TrailDialog {
  open(at?: Partial<DialogState>): void
  /** Every key while `/trail` is open, ahead of the keymap: see `intercept` in index.tsx. */
  intercept(ctx: InterceptContext): void
}

export function createDialog(input: {
  api: Host
  log: Log
  live: Live
  dialog: DialogState
  painter: Painter
  actions: Actions
  sessions: Sessions
}): TrailDialog {
  const { api, log, live, dialog, painter, actions, sessions } = input
  const { draw, dialogLines } = painter

  const move = (by: number) => {
    const items = painter.shown()?.items ?? []
    const at = Math.max(
      0,
      items.findIndex((item) => item.key === dialog.selected),
    )
    dialog.selected = items[Math.max(0, Math.min(items.length - 1, at + by))]?.key
    draw()
  }

  const target = () => painter.shown()?.target ?? {}

  const enter = () => {
    const url = target().open
    if (url) actions.open(url)
  }

  const go = () => {
    const to = target().go
    if (!to) return
    /** Close first: both versions drew the switch cleanly that way (docs/opencode/trail-interface.md). */
    api.ui.dialog.clear()
    log.debug("go", { session: to })
    sessions.navigate(to)
  }

  const remove = async () => {
    const key = target().remove
    const record = key ? live.state.records.get(key) : undefined
    if (!key || !record) return
    const ok = await actions.write([
      {
        v: 1,
        at: Date.now(),
        id: `rm_${key}_${Date.now().toString(36)}`,
        type: "removed",
        record: key,
        rootSession: record.session,
      },
    ])
    if (ok) actions.toast(`Removed "${record.title}" from the trail.`, "success")
  }

  const markdown = () => {
    const arranged = painter.shown()?.arranged
    if (!arranged || arranged.total === 0)
      return actions.toast("Nothing to copy yet: the trail is empty.", "info")
    actions.copy(
      markdownOf(arranged),
      `${arranged.shown} ${arranged.shown === 1 ? "thing" : "things"} as markdown`,
    )
  }

  const switchTab = () => {
    dialog.tab = dialog.tab === "this" ? "all" : "this"
    dialog.selected = undefined
    if (dialog.tab === "all") void actions.listTitles()
    draw()
  }

  /** A click on a row takes the cursor; on the row already under it, `enter`. */
  const click = (_x: number, y: number) => {
    const hit = painter.shown()?.hits.find((each) => each.y === y)
    if (!hit) return
    if (hit.key === dialog.selected) return enter()
    dialog.selected = hit.key
    draw()
  }

  const run = (fn: () => unknown) => () => {
    if (dialog.searching) return
    void Promise.resolve(fn()).catch((error) => log.warn("action failed", { error }))
  }

  const dialogLayer = (): Layer => ({
    priority: 100,
    commands: [
      { name: "cockpit.trail.down", title: "Next", run: run(() => move(1)) },
      { name: "cockpit.trail.up", title: "Previous", run: run(() => move(-1)) },
      { name: "cockpit.trail.tab", title: "This conversation, or all", run: run(() => switchTab()) },
      { name: "cockpit.trail.enter", title: "Open the page", run: run(() => enter()) },
      { name: "cockpit.trail.go", title: "Go to the conversation", run: run(() => go()) },
      {
        name: "cockpit.trail.copyLink",
        title: "Copy the link",
        run: run(() => target().copy && actions.copy(target().copy as string, "the link")),
      },
      { name: "cockpit.trail.remove", title: "Remove from the trail", run: run(() => remove()) },
      { name: "cockpit.trail.markdown", title: "Copy as markdown", run: run(() => markdown()) },
      {
        name: "cockpit.trail.search",
        title: "Search",
        run: run(() => {
          dialog.searching = true
          draw()
        }),
      },
      { name: "cockpit.trail.close", title: "Close", run: run(() => api.ui.dialog.clear()) },
    ],
    bindings: [
      { key: "j,down", cmd: "cockpit.trail.down" },
      { key: "k,up", cmd: "cockpit.trail.up" },
      { key: "tab", cmd: "cockpit.trail.tab" },
      { key: "return", cmd: "cockpit.trail.enter" },
      { key: "g", cmd: "cockpit.trail.go" },
      { key: "c", cmd: "cockpit.trail.copyLink" },
      { key: "x", cmd: "cockpit.trail.remove" },
      { key: "m", cmd: "cockpit.trail.markdown" },
      { key: "/", cmd: "cockpit.trail.search" },
      { key: "q", cmd: "cockpit.trail.close" },
    ],
  })

  /** The search being typed gets every key, and `esc` clears a search before the host closes the dialog. */
  const intercept = (ctx: InterceptContext) => {
    if (!dialog.open) return
    const event = ctx.event
    if (dialog.searching) {
      ctx.consume({ preventDefault: true, stopPropagation: true })
      if (event.name === "escape") {
        dialog.searching = false
        dialog.query = ""
      } else if (event.name === "return" || event.name === "enter") dialog.searching = false
      else if (event.name === "backspace") dialog.query = dialog.query.slice(0, -1)
      else if (event.sequence && !event.ctrl && !event.meta && event.sequence >= " ")
        dialog.query += event.sequence
      dialog.selected = undefined
      return draw()
    }
    if (event.name !== "escape" || dialog.query === "") return
    ctx.consume({ preventDefault: true, stopPropagation: true })
    dialog.query = ""
    dialog.selected = undefined
    draw()
  }

  const open = (at: Partial<DialogState> = {}) => {
    Object.assign(dialog, {
      open: true,
      /** With no conversation on screen there is no "this": the project's trail. */
      tab: live.root ? (at.tab ?? "this") : "all",
      selected: at.selected,
      query: at.query ?? "",
      searching: false,
    })
    void actions.sync()
    if (dialog.tab === "all") void actions.listTitles()
    painter.paint()
    api.ui.dialog.replace(
      () => (
        <Dialog
          api={api}
          rows={dialogLines}
          keys={dialogLayer}
          onScroll={(by) => move(by)}
          onClick={(x, y) => click(x, y)}
        />
      ),
      () => {
        dialog.open = false
        dialog.searching = false
      },
    )
    api.ui.dialog.setSize("xlarge")
    log.debug("trail: open", { tab: dialog.tab, items: painter.shown()?.items.length ?? 0 })
  }

  return { open, intercept }
}
