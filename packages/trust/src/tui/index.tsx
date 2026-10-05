/** @jsxImportSource @opentui/solid */

/**
 * Trust's interface half — the only half it has. OpenCode's `permission.ask` server hook is declared
 * and never called (docs/opencode/permissions.md), so a plugin answers a request the way OpenCode's
 * own auto mode does: from the interface, on `permission.asked`, with a reply of "once".
 *
 * Everything that decides is in `core/`; this file wires it to the host: events in, a reply out, the
 * ledger file read and appended, and the two surfaces — the sidebar block and the ledger dialog.
 */

import { defaultKeys } from "@opencode-cockpit/client/catalog"
import { warnRows } from "@opencode-cockpit/client/design"
import { claimFeature, duplicateFeatureMessage } from "@opencode-cockpit/client/feature"
import { bindingLookup, dualTui, type Host, type Layer } from "@opencode-cockpit/client/host"
import { noticeText } from "@opencode-cockpit/client/settings"
import { blockWidth } from "@opencode-cockpit/client/sidebar"
import type { BoxRenderable } from "@opentui/core"
import { createSignal } from "solid-js"
import { commandOf, type Seen } from "../core/adapt/seen.ts"
import { loadTrust, resolveSettings, type TrustConfig } from "../core/config.ts"
import { createEngine } from "../core/engine.ts"
import type { Request } from "../core/keys.ts"
import type { Event } from "../core/ledger.ts"
import { trustPaths } from "../core/paths.ts"
import { rulesFrom } from "../core/rules.ts"
import { configSnippet, type Outcome, revoke, type Target, widen, widenScope } from "../core/view/actions.ts"
import { type ActivityView, activityRows, targetOf } from "../core/view/activity.ts"
import {
  ALWAYS_KEY,
  type ExplorerView,
  explorerRows,
  type Node,
  nodeTarget,
  reveal,
} from "../core/view/explorer.ts"
import type { Family } from "../core/view/model.ts"
import type { Hit } from "../core/view/parts.ts"
import type { Row, Tone } from "../core/view/rows.ts"
import { sidebarRows, tally } from "../core/view/sidebar.ts"
import { createJournal } from "./journal.ts"
import { createSource } from "./source.ts"
import { Dialog } from "./view/dialog.tsx"
import { Rows } from "./view/rows.tsx"

const TRUST_PACKAGE = "@opencode-cockpit/trust"

const DEFAULT_KEYS = defaultKeys("trust")

export type TrustTuiOptions = TrustConfig

/** How often other windows' events are read from the ledger, and pending requests checked. */
const SYNC_MS = 3_000
/** How long a bash request waits for its call's command line before it is decided without one. */
const PARK_MS = 1_000
/** Calls remembered for their command line: far more than can be waiting at once. */
const CALLS_MAX = 500
/** The host's dialog: as wide as xlarge allows (Shell's console measured it). */
const DIALOG_COLUMNS = 116

/** Trust's interface half as a factory, so the `opencode-cockpit` bundle can include it. */
export function createTrustTui({ source = TRUST_PACKAGE }: { source?: string } = {}) {
  return async (api: Host, rawOptions?: unknown) => {
    const log = api.log.child("trust")
    const claim = claimFeature(api.renderer, "trust", source)
    if (!claim.active) {
      log.warn("configured twice", { owner: claim.owner, skipped: source })
      api.ui.toast({
        variant: "warning",
        title: "Trust",
        message: duplicateFeatureMessage("Trust", claim.owner, source),
      })
      return
    }
    api.lifecycle.onDispose(() => claim.release())

    const directory = api.state.path.directory
    const { config, order, notices } = await loadTrust(directory, rawOptions)
    for (const notice of notices) log.warn("settings", { file: notice.file, notice: notice.text })
    const settings = resolveSettings(config)
    if (!settings.enabled) {
      log.info("off by config", { directory })
      return
    }
    const keys = bindingLookup({ ...DEFAULT_KEYS, ...config.keybinds })
    const paths = trustPaths(directory)
    const journal = createJournal(paths)
    const engine = createEngine({ ...settings, keep: 20 })

    /** OpenCode's config as its `config.get` returned it; undefined until read, and Trust stays out. */
    let opencodeConfig: unknown
    let rulesReady = false
    /** Something you should know about. The sidebar says it whatever else it has to say. */
    let trouble: string | undefined
    const calls = new Map<string, { line?: string; workdir?: string }>()
    const agents = new Map<string, string>()

    // --- painting ----------------------------------------------------------------------------------

    const [sidebarLines, setLines] = createSignal<readonly Row[]>([])
    const [dialogRows, setDialogRows] = createSignal<readonly Row[]>([])
    let block: BoxRenderable | undefined
    let drawnAt = 0
    let said = ""
    const sidebarWidth = () => blockWidth(block, api.renderer.width)

    /**
     * The dialog: the activity `/trust` opens on, and the ledger behind `l`. Each keeps its own cursor
     * by key, so a rule revoked or a family folded moves the rows about, not the cursor.
     */
    const dialog = {
      open: false,
      view: "activity" as "activity" | "ledger",
      /** `?`: every key, in the body's place. */
      keys: false,
      notice: undefined as { text: string; tone: Tone } | undefined,
      activity: undefined as string | undefined,
      node: undefined as string | undefined,
      /** Families opened, and those whose tail is listed too; every family starts folded. */
      opened: new Set<string>(),
      full: new Set<string>(),
      filter: "",
      /** `/` pressed: the text typed so far, until enter or esc. */
      typing: undefined as string | undefined,
      /** `tab` into the card: the focused button. */
      button: undefined as number | undefined,
    }
    /** What was drawn last: actions and clicks act on what is on screen. */
    let shown: { activity?: ActivityView; ledger?: ExplorerView } = {}
    const reading = () => ({ state: engine.state, settings, now: Date.now(), history: engine.history })
    const project = directory.split(/[\\/]/).filter(Boolean).at(-1) ?? ""

    /**
     * Off by default (core/config.ts): the sidebar is crowded, and Trust answers the same without it.
     * The palette flips it for the session; config decides where it starts. Not remembered across
     * restarts — remembered UI state makes a command look dead (docs/opencode/gotchas.md).
     */
    let inSidebar = settings.sidebar
    const paint = () => {
      drawnAt = sidebarWidth()
      /**
       * A setting in Trust's section that is not read — a value of the wrong kind — is
       * a `!` row on top, for the session, until the file is fixed. Shown with the block hidden too:
       * like trouble, a setting that silently does nothing is what nobody would find otherwise.
       */
      const warned: Row[] = notices.flatMap((notice) => warnRows(noticeText(notice), drawnAt))
      /** Hidden, the block says nothing — except trouble: a failure always speaks. */
      const block =
        !inSidebar && !trouble
          ? []
          : sidebarRows({
              width: drawnAt,
              recent: engine.recent(),
              count: engine.count(),
              pending: engine.pending(),
              state: engine.state,
              limit: settings.sidebarRows,
              shown: inSidebar,
              ...(inSidebar ? { project: tally(engine.state, settings, Date.now()) } : {}),
              ...(trouble ? { trouble } : {}),
            })
      const next = [...warned, ...block]
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

    // --- the ledger file ---------------------------------------------------------------------------

    /** Everything new in the file — this window's events and every other's — into the state. */
    const sync = () =>
      journal
        .read()
        .then(({ events, reset }) => {
          if (events.length === 0 && !reset) return
          engine.load(events, { reset })
          draw()
        })
        .catch((error) => {
          log.error("ledger unreadable", { file: paths.events, error })
          trouble = "ledger unreadable — see cockpit.log"
          draw()
        })

    const write = (events: readonly Event[]) => {
      if (events.length === 0) return
      journal
        .append(events)
        .then(() => {
          if (trouble?.startsWith("ledger not saved")) trouble = undefined
          return sync()
        })
        .catch((error) => {
          log.error("ledger not saved", { file: paths.events, error })
          trouble = `ledger not saved: ${(error as NodeJS.ErrnoException).code ?? "error"}`
          draw()
        })
    }

    // --- requests ----------------------------------------------------------------------------------

    const loadRules = async () => {
      try {
        opencodeConfig = await feed.config()
        rulesReady = true
        if (trouble?.startsWith("OpenCode's config")) trouble = undefined
        log.debug("rules", { rules: rulesFrom(opencodeConfig).length })
      } catch (error) {
        /** Without the rules there is no knowing what you asked to be asked about: Trust stays out. */
        rulesReady = false
        log.error("config unreadable", { error })
        trouble = "OpenCode's config unreadable — not answering"
      }
      draw()
    }

    /**
     * Bash requests whose call has not said its command line yet, by call id. Measured on 1.18.32: the
     * call's `running` update — the one carrying `command` — arrived *after* `permission.asked` for
     * three requests in four (the first call of a turn was the exception). So a request without its
     * line waits for it, briefly; one that never gets it is decided without, which means asked.
     */
    const parked = new Map<string, { request: Request; at: number; timer: ReturnType<typeof setTimeout> }>()

    const lineOf = (request: Request) =>
      request.call ? (calls.get(request.call) ?? feed.call(request)) : undefined

    const asked = (request: Request, at: number) => {
      /**
       * Decided as soon as the request can be read, never after a file read: OpenCode's `--auto`
       * answers in 15–22ms, and a decision that waited on the disk could answer a request already gone.
       */
      if (!rulesReady) return
      const call = lineOf(request)
      if (
        request.permission === "bash" &&
        call?.line === undefined &&
        request.call &&
        !parked.has(request.call)
      ) {
        const key = request.call
        parked.set(key, { request, at, timer: setTimeout(() => unpark(key), PARK_MS) })
        return
      }
      decideNow(request, at, call)
    }

    /** The call's line arrived, a reply came first, or the wait ran out: decide with what is known. */
    const unpark = (key: string) => {
      const waiting = parked.get(key)
      if (!waiting) return
      parked.delete(key)
      clearTimeout(waiting.timer)
      if (!lineOf(waiting.request)) log.debug("no command line", { request: waiting.request.id, call: key })
      decideNow(waiting.request, waiting.at, lineOf(waiting.request))
    }

    const decideNow = (request: Request, at: number, call: ReturnType<typeof lineOf>) => {
      const agent =
        agents.get(request.sessionID) ?? feed.agent(request.sessionID, request.messageID) ?? "unknown"
      const { judgement, event } = engine.ask({
        request,
        context: { ...call, root: directory },
        agent,
        rules: rulesFrom(opencodeConfig, agent),
        at,
      })
      log.debug("asked", { request: request.id, permission: request.permission, agent, why: judgement.why })
      write([event])
      draw()
      if (!judgement.answer) return
      feed
        .approve(request)
        .then(() => {
          const auto = engine.answered(request.id, Date.now())
          if (auto) write([auto])
          log.info("auto", {
            request: request.id,
            session: request.sessionID,
            call: request.call,
            permission: request.permission,
            agent,
            subjects: judgement.items.map((item) => item.subject),
            why: judgement.why,
            ms: Date.now() - at,
          })
          if (trouble?.startsWith("an answer failed")) trouble = undefined
          draw()
        })
        .catch((error) => {
          /** The prompt is still there and yours: your answer to it counts as any other. */
          engine.failed(request.id)
          log.warn("auto reply failed", { request: request.id, error })
          trouble = `an answer failed: ${error instanceof Error ? error.message : String(error)}`
          draw()
        })
    }

    const feed = createSource(api, log, (seen: Seen[]) => {
      const at = Date.now()
      for (const each of seen) {
        switch (each.type) {
          case "call": {
            calls.set(each.call, commandOf(each.input))
            if (calls.size > CALLS_MAX) calls.delete(calls.keys().next().value as string)
            if (parked.has(each.call) && calls.get(each.call)?.line !== undefined) unpark(each.call)
            break
          }
          case "agent":
            agents.set(each.sessionID, each.agent)
            break
          case "config":
            void loadRules()
            break
          case "asked":
            asked(each.request, at)
            break
          case "replied": {
            /** Answered while it waited for its line: decided first, so the answer counts against it. */
            for (const [key, waiting] of parked) if (waiting.request.id === each.requestID) unpark(key)
            const { events, credit } = engine.replied({ requestID: each.requestID, reply: each.reply, at })
            if (credit.kind === "ignored")
              log.debug("reply not counted", { request: each.requestID, why: credit.why })
            write(events)
            draw()
            break
          }
        }
      }
    })

    /** Requests already waiting when Trust started, and any the events never told us were answered. */
    const reconcile = async (adopt: boolean) => {
      const listed = await feed.pending().catch((error) => {
        log.debug("pending list failed", { error })
        return undefined
      })
      if (!listed) return
      const ids = new Set<string>()
      for (const each of listed) {
        if (each.type !== "asked") continue
        ids.add(each.request.id)
        /** Its asking was not seen, so "now" stands in for it: a person answers later still. */
        if (adopt) asked(each.request, Date.now())
      }
      engine.reconcile(ids, Date.now())
      draw()
    }

    const boot = async () => {
      await sync()
      await loadRules()
      await reconcile(true)
      log.info("ready", {
        ledger: paths.events,
        threshold: settings.threshold,
        dangerExtra: settings.dangerExtra,
        expireDays: settings.expireDays,
        rules: rulesReady,
      })
    }
    void boot()

    let ticking: ReturnType<typeof setInterval> | undefined = setInterval(() => {
      void sync()
      if (engine.pending().length > 0) void reconcile(false)
      /** The sidebar was laid out, or resized, since the rows were drawn. */
      if (sidebarWidth() !== drawnAt) draw()
    }, SYNC_MS)

    // --- the ledger dialog -------------------------------------------------------------------------

    const notice = (text: string, tone: Tone = "muted") => {
      dialog.notice = { text, tone }
      draw()
    }

    /** What `x`, `w` and `c` act on: the cursor's item or node, as last drawn. */
    const selected = (): { target: Target; families: readonly Family[] } | undefined => {
      if (dialog.view === "activity") {
        const view = shown.activity
        if (!view?.item) return undefined
        return { target: targetOf(view.item, view.model), families: view.model.families }
      }
      const view = shown.ledger
      if (!view?.node) return undefined
      return { target: nodeTarget(view.node), families: view.model.families }
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
      if (now) act("revoked", revoke(now.target, reading(), Date.now()))
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
        const items = shown.activity?.model.items ?? []
        const at = Math.max(
          0,
          items.findIndex((item) => item.key === dialog.activity),
        )
        dialog.activity = items[Math.max(0, Math.min(items.length - 1, at + by))]?.key
      } else {
        const nodes = shown.ledger?.model.nodes ?? []
        const at = Math.max(
          0,
          nodes.findIndex((node) => node.key === dialog.node),
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

    /** `enter` on the activity: why — the card of the rule that answered, or that is close, in the ledger. */
    const why = () => {
      const view = shown.activity
      const item = view?.item
      if (!view || !item) return toLedger()
      if (item.kind === "always") return toLedger(ALWAYS_KEY)
      const subject =
        item.kind === "answer"
          ? { permission: item.answer.permission, subject: item.answer.items[0]?.subject ?? "" }
          : { permission: item.command.permission, subject: item.command.subject }
      toLedger(reveal({ open: dialog.opened, full: dialog.full }, view.model.families, subject))
    }

    const node = (): Node | undefined => shown.ledger?.node

    /**
     * `space`/`enter` on a heading opens or folds it; on `+ N more` it lists the rest; on a command in a
     * family it folds the family, the cursor going to its heading. `→` only opens, `←` only folds.
     */
    const fold = (way: "toggle" | "open" | "close" = "toggle") => {
      const at = node()
      if (!at || at.kind === "always") return
      dialog.notice = undefined
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
    const buttons = () => shown.ledger?.buttons ?? []
    const press = (action: string) => {
      if (action === "revoke") revokeSelected()
      else if (action === "widen") widenSelected()
      else if (action === "copy") copy()
      else if (action === "ledger") toLedger()
    }

    const enter = () => {
      if (dialog.view === "activity") return why()
      if (dialog.button !== undefined) {
        const button = buttons()[dialog.button]
        if (button && !button.off) press(button.action)
        return
      }
      const at = node()
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
        (dialog.view === "activity" ? shown.activity?.hits : shown.ledger?.hits) ?? []
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
     * a time — the key list, the card's buttons, the filter, the ledger — before the host closes the
     * dialog from the activity, as it always has.
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
          else if (dialog.view === "activity") return
          else if (dialog.button !== undefined) dialog.button = undefined
          else if (dialog.filter !== "") {
            dialog.filter = ""
            dialog.node = undefined
          } else dialog.view = "activity"
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
      Object.assign(dialog, {
        open: true,
        view: "activity",
        keys: false,
        notice: undefined,
        activity: undefined,
        typing: undefined,
        button: undefined,
      })
      paint()
      api.ui.dialog.replace(
        () => (
          <Dialog
            api={api}
            rows={dialogRows}
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
      log.debug("trust: open", { items: shown.activity?.model.items.length ?? 0 })
    }

    api.keymap.registerLayer({
      commands: [
        {
          name: "cockpit.trust.ledger",
          title: "Show what Trust answers for you",
          category: "Cockpit · Trust",
          namespace: "palette",
          slashName: "trust",
          run: () => openLedger(),
        },
        {
          name: "cockpit.trust.sidebar",
          title: "Show or hide Trust in the sidebar",
          desc: "for this session",
          category: "Cockpit · Trust",
          namespace: "palette",
          run: () => {
            inSidebar = !inSidebar
            log.debug("sidebar", { shown: inSidebar })
            paint()
            /** Said as well as drawn: on the home screen there is no sidebar to show it in. */
            api.ui.toast({
              variant: "info",
              title: "Trust",
              message: inSidebar ? "Shown in the sidebar." : "Hidden from the sidebar.",
            })
          },
        },
        {
          name: "cockpit.trust.pause",
          title: "Pause or resume Trust in this project",
          category: "Cockpit · Trust",
          namespace: "palette",
          run: () => togglePause(),
        },
      ],
      bindings: keys.gather("cockpit", Object.keys(DEFAULT_KEYS)),
    })

    api.slots.register({
      /** Last of Cockpit's blocks by default; the top-level `sidebar` list moves it. */
      order,
      slots: {
        sidebar_content: () => (
          <Rows
            api={api}
            rows={sidebarLines}
            onReady={(box) => {
              block = box
              draw()
            }}
          />
        ),
      },
    })

    api.lifecycle.onDispose(() => {
      for (const waiting of parked.values()) clearTimeout(waiting.timer)
      parked.clear()
      clearInterval(ticking)
      ticking = undefined
      feed.dispose()
    })
  }
}

/** One entry for both OpenCodes: v1 calls `tui`, v2 calls `setup` (docs/opencode/v2.md). */
export default dualTui("opencode-cockpit.trust", createTrustTui())
