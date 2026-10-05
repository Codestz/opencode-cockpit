/** @jsxImportSource @opentui/solid */

/**
 * `/trust`: the ledger it opens on and the activity behind `a` — the keys, the clicks, the filter
 * typed with `/`, and what `x`, `w`, `c` and `p` do to the ledger. Painted by `paint.ts`, from the
 * `DialogState` this changes.
 */

import type { Host, Layer } from "@opencode-cockpit/client/host"
import type { Log } from "@opencode-cockpit/client/log"
import type { Engine } from "../core/engine.ts"
import type { Event } from "../core/ledger.ts"
import { configSnippet, type Outcome, revoke, type Target, widen, widenScope } from "../core/view/actions.ts"
import { targetOf } from "../core/view/activity.ts"
import type { Family } from "../core/view/model.ts"
import type { Hit } from "../core/view/parts.ts"
import type { Tone } from "../core/view/rows.ts"
import { ALWAYS_KEY, type Node, nodeTarget, reveal } from "../core/view/tree.ts"
import type { DialogState, Painter } from "./paint.ts"
import { Dialog } from "./view/dialog.tsx"

export interface Ledger {
  /** Opens `/trust` on the activity. */
  open(): void
  /** Pauses Trust in this project, or resumes it: said in the dialog when it is open, else a toast. */
  togglePause(): void
}

export function createLedger(input: {
  api: Host
  log: Log
  engine: Engine
  directory: string
  painter: Painter
  dialog: DialogState
  write: (events: readonly Event[]) => void
  loadRules: () => Promise<void>
}): Ledger {
  const { api, log, engine, directory, painter, dialog, write, loadRules } = input
  const draw = painter.draw

  const notice = (text: string, tone: Tone = "muted") => {
    dialog.notice = { text, tone }
    draw()
  }

  /** What `x`, `w` and `c` act on: the cursor's item or node, as last drawn. */
  const selected = (): { target: Target; families: readonly Family[] } | undefined => {
    if (dialog.view === "activity") {
      const view = painter.shown().activity
      if (!view?.item) return undefined
      return { target: targetOf(view.item, view.model), families: view.model.families }
    }
    const view = painter.shown().ledger
    if (!view?.node) return undefined
    const target = nodeTarget(view.node)
    return target ? { target, families: view.model.families } : undefined
  }

  /** What `w` and `x` decided, appended and said. Nothing is ever rewritten in the ledger. */
  const act = (name: string, outcome: Outcome) => {
    write(outcome.events)
    if (outcome.events.length > 0)
      log.info(name, {
        events: outcome.events.map((event) =>
          event.type === "revoked"
            ? { type: event.type, agent: event.agent, subject: event.subject }
            : event.type === "widened" || event.type === "unwidened"
              ? { type: event.type, agent: event.agent, family: event.family }
              : { type: event.type },
        ),
      })
    notice(outcome.notice.text, outcome.notice.tone)
  }

  const revokeSelected = () => {
    const now = selected()
    if (now) act("revoked", revoke(now.target, painter.reading(), Date.now()))
  }

  const widenSelected = () => {
    const now = selected()
    if (now) act("widen", widen(widenScope(now.target, now.families), now.families, Date.now()))
  }

  const copy = () => {
    const now = selected()
    if (!now) return
    const snippet = configSnippet(now.target)
    const ok = api.renderer.copyToClipboardOSC52?.(snippet.text) ?? false
    notice(
      ok
        ? `Copied ${snippet.text} — paste it into opencode.json${snippet.note ? `; ${snippet.note}` : ""}.`
        : `This terminal refused the clipboard. The rule: ${snippet.text}`,
      ok ? "success" : "warning",
    )
  }

  /** Every key but `?` acts on the screen: from the key list it goes back to the screen first. */
  const listed =
    (run: () => void): (() => void) =>
    () => {
      dialog.keys = false
      run()
      draw()
    }

  const move = (by: number) => {
    dialog.notice = undefined
    if (dialog.view === "activity") {
      const items = painter.shown().activity?.model.items ?? []
      const at = Math.max(
        0,
        items.findIndex((item) => item.key === dialog.activity),
      )
      dialog.activity = items[Math.max(0, Math.min(items.length - 1, at + by))]?.key
    } else {
      const nodes = painter.shown().ledger?.model.nodes ?? []
      const current = dialog.node ?? painter.shown().ledger?.node?.key
      const at = Math.max(
        0,
        nodes.findIndex((node) => node.key === current),
      )
      dialog.node = nodes[Math.max(0, Math.min(nodes.length - 1, at + by))]?.key
      dialog.button = undefined
    }
    draw()
  }

  /** Into the ledger, on `key` when given; the activity keeps its cursor for the way back. */
  const toLedger = (key?: string) => {
    dialog.view = "ledger"
    dialog.button = undefined
    dialog.notice = undefined
    if (key !== undefined) dialog.node = key
    draw()
  }

  /** The full activity, from the ledger: `a`, the Today strip's `enter`, or its button. */
  const toActivity = () => {
    dialog.view = "activity"
    dialog.button = undefined
    dialog.notice = undefined
    draw()
  }

  /** `enter` on the activity: why — the card of the rule that answered, or that is close, in the ledger. */
  const why = () => {
    const view = painter.shown().activity
    const item = view?.item
    if (!view || !item) return toLedger()
    if (item.kind === "always") return toLedger(ALWAYS_KEY)
    const subject =
      item.kind === "answer"
        ? { permission: item.answer.permission, subject: item.answer.items[0]?.subject ?? "" }
        : { permission: item.command.permission, subject: item.command.subject }
    toLedger(reveal({ open: dialog.opened, full: dialog.full }, view.model.families, subject))
  }

  const node = (): Node | undefined => painter.shown().ledger?.node

  /**
   * `space`/`enter` on a heading opens or folds it; on `+ N more` it lists the rest; on a command in a
   * family it folds the family, the cursor going to its heading. `→` only opens, `←` only folds.
   */
  const fold = (way: "toggle" | "open" | "close" = "toggle") => {
    const at = node()
    if (!at || at.kind === "always" || at.kind === "today") return
    dialog.notice = undefined
    /** A kind's `seen once` row and a folder open and fold like a family, by their own key. */
    if (at.kind === "once" || at.kind === "group") {
      if (dialog.opened.has(at.key) && way !== "open") dialog.opened.delete(at.key)
      else if (!dialog.opened.has(at.key) && way !== "close") dialog.opened.add(at.key)
      return draw()
    }
    const key = at.family.key
    if (at.kind === "more") {
      if (way !== "close") dialog.full.add(key)
      else {
        dialog.opened.delete(key)
        dialog.node = `f:${key}`
      }
    } else if (at.kind === "command") {
      if (!at.nested || way === "open") return
      dialog.opened.delete(key)
      dialog.full.delete(key)
      dialog.node = `f:${key}`
    } else if (dialog.opened.has(key) && way !== "open") {
      dialog.opened.delete(key)
      dialog.full.delete(key)
    } else if (!dialog.opened.has(key) && way !== "close") dialog.opened.add(key)
    draw()
  }

  /** The card's buttons: `tab` in and out, `←`/`→` between them, `enter` presses the focused one. */
  const buttons = () => painter.shown().ledger?.buttons ?? []
  const press = (action: string) => {
    if (action === "revoke") revokeSelected()
    else if (action === "widen") widenSelected()
    else if (action === "copy") copy()
    else if (action === "ledger") toLedger()
    else if (action === "activity") toActivity()
  }

  const enter = () => {
    if (dialog.view === "activity") return why()
    if (dialog.button !== undefined) {
      const button = buttons()[dialog.button]
      if (button && !button.off) press(button.action)
      return
    }
    const at = node()
    if (at?.kind === "today") return toActivity()
    if (at?.kind === "command" || at?.kind === "always") {
      if (buttons().length > 0) dialog.button = 0
      return draw()
    }
    fold()
  }

  const sideways = (by: 1 | -1) => {
    if (dialog.view !== "ledger") return
    if (dialog.button !== undefined) {
      const count = buttons().length
      dialog.button = count > 0 ? (dialog.button + by + count) % count : undefined
      return draw()
    }
    fold(by > 0 ? "open" : "close")
  }

  const tab = () => {
    if (dialog.view !== "ledger") return
    dialog.button = dialog.button === undefined && buttons().length > 0 ? 0 : undefined
    draw()
  }

  const filter = () => {
    if (dialog.view === "activity") dialog.view = "ledger"
    dialog.typing = dialog.filter
    dialog.button = undefined
    draw()
  }

  /** A click: a button presses, a row takes the cursor. */
  const click = (x: number, y: number) => {
    const hits: readonly Hit[] =
      (dialog.view === "activity" ? painter.shown().activity?.hits : painter.shown().ledger?.hits) ?? []
    const on = hits.find(
      (hit) => hit.y === y && (hit.x0 === undefined || x >= hit.x0) && (hit.x1 === undefined || x < hit.x1),
    )
    if (!on) return
    dialog.keys = false
    if (on.kind === "button") {
      dialog.notice = undefined
      return press(on.action)
    }
    dialog.notice = undefined
    if (dialog.view === "activity") dialog.activity = on.key
    else {
      dialog.node = on.key
      dialog.button = undefined
    }
    draw()
  }

  const dialogLayer = (): Layer => ({
    priority: 100,
    commands: [
      { name: "cockpit.trust.down", title: "Next", run: listed(() => move(1)) },
      { name: "cockpit.trust.up", title: "Previous", run: listed(() => move(-1)) },
      { name: "cockpit.trust.enter", title: "Why, open, or press", run: listed(() => enter()) },
      { name: "cockpit.trust.fold", title: "Open or fold a family", run: listed(() => fold()) },
      {
        name: "cockpit.trust.right",
        title: "Open a family, or the next button",
        run: listed(() => sideways(1)),
      },
      {
        name: "cockpit.trust.left",
        title: "Fold a family, or the previous button",
        run: listed(() => sideways(-1)),
      },
      {
        name: "cockpit.trust.l",
        title: "Open the ledger, or a family in it",
        run: listed(() => (dialog.view === "activity" ? toLedger() : sideways(1))),
      },
      { name: "cockpit.trust.tab", title: "Into the card and back", run: listed(() => tab()) },
      {
        name: "cockpit.trust.activity",
        title: "The activity, or back to the ledger",
        run: listed(() => (dialog.view === "activity" ? toLedger() : toActivity())),
      },
      { name: "cockpit.trust.filter", title: "Filter the ledger", run: listed(() => filter()) },
      {
        name: "cockpit.trust.keys",
        title: "Show or hide every key",
        run: () => {
          dialog.keys = !dialog.keys
          dialog.notice = undefined
          draw()
        },
      },
      {
        name: "cockpit.trust.revoke",
        title: "Revoke, or forget a count",
        run: listed(() => revokeSelected()),
      },
      {
        name: "cockpit.trust.widen",
        title: "Trust the whole family, or undo it",
        run: listed(() => widenSelected()),
      },
      { name: "cockpit.trust.copy", title: "Copy as config", run: listed(() => copy()) },
      { name: "cockpit.trust.togglePause", title: "Pause or resume", run: listed(() => togglePause()) },
      { name: "cockpit.trust.close", title: "Close", run: () => api.ui.dialog.clear() },
    ],
    bindings: [
      { key: "j,down", cmd: "cockpit.trust.down" },
      { key: "k,up", cmd: "cockpit.trust.up" },
      { key: "return", cmd: "cockpit.trust.enter" },
      { key: "space", cmd: "cockpit.trust.fold" },
      { key: "right", cmd: "cockpit.trust.right" },
      { key: "h,left", cmd: "cockpit.trust.left" },
      { key: "l", cmd: "cockpit.trust.l" },
      { key: "tab", cmd: "cockpit.trust.tab" },
      { key: "a", cmd: "cockpit.trust.activity" },
      { key: "/", cmd: "cockpit.trust.filter" },
      { key: "?,shift+/", cmd: "cockpit.trust.keys" },
      { key: "x", cmd: "cockpit.trust.revoke" },
      { key: "w", cmd: "cockpit.trust.widen" },
      { key: "c", cmd: "cockpit.trust.copy" },
      { key: "p", cmd: "cockpit.trust.togglePause" },
      { key: "q", cmd: "cockpit.trust.close" },
    ],
  })

  /**
   * Ahead of the keymap, because the host's dialog takes `esc` before any layer hears it (Shell's
   * search does the same): the filter being typed gets every key; and `esc` steps back one thing at
   * a time — the key list, the activity, the card's buttons, the filter — before the host closes the
   * dialog from the ledger.
   */
  api.lifecycle.onDispose(
    api.keymap.intercept(
      (ctx) => {
        if (!dialog.open) return
        const event = ctx.event
        if (dialog.typing !== undefined) {
          ctx.consume({ preventDefault: true, stopPropagation: true })
          if (event.name === "escape") dialog.typing = undefined
          else if (event.name === "return" || event.name === "enter") {
            dialog.filter = dialog.typing.trim()
            dialog.typing = undefined
            dialog.node = undefined
          } else if (event.name === "backspace") dialog.typing = dialog.typing.slice(0, -1)
          else if (event.sequence && !event.ctrl && !event.meta && event.sequence >= " ")
            dialog.typing += event.sequence
          return draw()
        }
        if (event.name !== "escape") return
        if (dialog.keys) dialog.keys = false
        else if (dialog.view === "activity") dialog.view = "ledger"
        else if (dialog.button !== undefined) dialog.button = undefined
        else if (dialog.filter !== "") {
          dialog.filter = ""
          dialog.node = undefined
        } else return
        ctx.consume({ preventDefault: true, stopPropagation: true })
        dialog.notice = undefined
        draw()
      },
      { priority: 10_000 },
    ),
  )

  const openLedger = () => {
    /** Config may have changed since: what the dialog says about "ask" rules should be today's. */
    void loadRules()
    /** The ledger first, the cursor on its first rule; today's answers are the strip above it. */
    Object.assign(dialog, {
      open: true,
      view: "ledger",
      keys: false,
      notice: undefined,
      activity: undefined,
      node: undefined,
      typing: undefined,
      button: undefined,
    })
    painter.paint()
    api.ui.dialog.replace(
      () => (
        <Dialog
          api={api}
          rows={painter.dialogRows}
          keys={dialogLayer}
          onScroll={(by) => listed(() => move(by))()}
          onClick={(x, y) => click(x, y)}
        />
      ),
      () => {
        dialog.open = false
        dialog.typing = undefined
      },
    )
    api.ui.dialog.setSize("xlarge")
    log.debug("trust: open", { rules: painter.shown().ledger?.model.nodes.length ?? 0 })
  }

  const togglePause = () => {
    const paused = !engine.state.paused
    write([{ v: 1, at: Date.now(), type: paused ? "paused" : "resumed" }])
    log.info(paused ? "paused" : "resumed", { directory })
    if (dialog.open)
      notice(paused ? "Paused in this project: Trust keeps counting, and answers nothing." : "Resumed.")
    else
      api.ui.toast({
        variant: "info",
        title: "Trust",
        message: paused ? "Paused in this project." : "Answering again in this project.",
      })
  }

  return { open: openLedger, togglePause }
}
