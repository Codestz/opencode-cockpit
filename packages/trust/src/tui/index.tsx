/** @jsxImportSource @opentui/solid */

/**
 * Trust's interface half — the only half it has. OpenCode's `permission.ask` server hook is declared
 * and never called (docs/opencode/permissions.md), so a plugin answers a request the way OpenCode's
 * own auto mode does: from the interface, on `permission.asked`, with a reply of "once".
 *
 * Everything that decides is in `core/`; this file wires it to the host: events in, a reply out, the
 * ledger file read and appended, and the two surfaces — the sidebar block and the ledger dialog.
 */

import { claimFeature, duplicateFeatureMessage } from "@opencode-cockpit/client/feature"
import { bindingLookup, dualTui, type Host, type Layer } from "@opencode-cockpit/client/host"
import { sidebarOrder } from "@opencode-cockpit/client/sidebar"
import type { BoxRenderable } from "@opentui/core"
import { createSignal } from "solid-js"
import { commandOf, type Seen } from "../core/adapt/seen.ts"
import { loadTrustConfig, resolveSettings, type TrustConfig } from "../core/config.ts"
import { createEngine } from "../core/engine.ts"
import type { Request } from "../core/keys.ts"
import type { Event } from "../core/ledger.ts"
import { trustPaths } from "../core/paths.ts"
import { rulesFrom } from "../core/rules.ts"
import {
  configSnippet,
  type Line,
  ledgerModel,
  ledgerRows,
  type Outcome,
  revokeLine,
  widenLine,
} from "../core/view/ledger.ts"
import type { Row, Tone } from "../core/view/rows.ts"
import { sidebarRows } from "../core/view/sidebar.ts"
import { createJournal } from "./journal.ts"
import { createSource } from "./source.ts"
import { Ledger } from "./view/ledger.tsx"
import { Rows } from "./view/rows.tsx"

const TRUST_PACKAGE = "@opencode-cockpit/trust"

/** `<leader>p`, for permissions: free on both OpenCodes (1.18.32's and 2.0.18's defaults) and in Cockpit. */
const DEFAULT_KEYS = {
  "cockpit.trust.ledger": "<leader>p",
}

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
    const config = await loadTrustConfig(directory, rawOptions)
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
    const sidebarWidth = () => {
      /** The container the host gave the block, as Subagents measures it: the block's own width follows its rows. */
      const parent = (block?.parent as { width?: number } | null | undefined)?.width ?? 0
      const own = block?.width ?? 0
      const measured = parent >= 12 ? Math.min(parent, own >= 12 ? own : parent) : own
      return measured >= 12 ? measured : Math.max(20, Math.min(40, Math.floor(api.renderer.width / 4) - 2))
    }

    const ledger = {
      open: false,
      /** The line under the cursor, by key: folding a family moves lines about, not the cursor. */
      selected: undefined as string | undefined,
      /** Commands approved once are folded until `a` lists them (core/view/ledger.ts, ledgerShown). */
      all: false,
      /** Families opened with `enter`; every family starts folded. */
      opened: new Set<string>(),
      notice: undefined as { text: string; tone: Tone } | undefined,
    }
    const reading = () => ({ state: engine.state, settings, now: Date.now() })
    const model = () => ledgerModel({ ...reading(), all: ledger.all, open: ledger.opened })
    const lines = () => model().lines
    /** The cursor's index, put back on a line that exists when its own went (revoked, folded). */
    const cursor = (list: readonly Line[]) => {
      const at = list.findIndex((line) => line.key === ledger.selected)
      return at >= 0 ? at : 0
    }

    /**
     * Off by default (core/config.ts): the sidebar is crowded, and Trust answers the same without it.
     * The palette flips it for the session; config decides where it starts. Not remembered across
     * restarts — remembered UI state makes a command look dead (docs/opencode/gotchas.md).
     */
    let inSidebar = settings.sidebar
    const paint = () => {
      drawnAt = sidebarWidth()
      /** Hidden, the block says nothing — except trouble: a failure always speaks. */
      const next =
        !inSidebar && !trouble
          ? []
          : sidebarRows({
              width: drawnAt,
              recent: engine.recent(),
              count: engine.count(),
              pending: engine.pending(),
              state: engine.state,
              limit: settings.sidebarRows,
              ...(trouble ? { trouble } : {}),
            })
      /** Only when they changed: new rows rebuild every line of the block. */
      const text = JSON.stringify(next)
      if (text !== said) {
        said = text
        setLines(next)
      }
      if (ledger.open) {
        const { lines: list, folded } = model()
        ledger.selected = list[cursor(list)]?.key
        const height = api.renderer.height
        setDialogRows(
          ledgerRows({
            width: Math.max(40, Math.min(DIALOG_COLUMNS, api.renderer.width - 2)),
            height: Math.max(11, height - Math.floor(height / 4) * 2),
            lines: list,
            ...(ledger.selected !== undefined ? { selected: ledger.selected } : {}),
            folded,
            all: ledger.all,
            state: engine.state,
            settings,
            now: Date.now(),
            ...(ledger.notice ? { notice: ledger.notice } : {}),
          }).rows,
        )
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
      ledger.notice = { text, tone }
      draw()
    }
    const selectedLine = () => {
      const list = lines()
      return list[cursor(list)]
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

    const revoke = () => {
      const line = selectedLine()
      if (line) act("revoked", revokeLine(line, reading(), Date.now()))
    }

    const widen = () => {
      const line = selectedLine()
      if (line) act("widen", widenLine(line, Date.now()))
    }

    /** `enter`: a heading opens or folds; a row inside a family folds it and keeps the cursor on it. */
    const fold = () => {
      const line = selectedLine()
      if (!line || line.kind === "always") return
      if (line.kind === "rule" && !line.nested) return
      const key = line.family.key
      if (ledger.opened.has(key)) {
        ledger.opened.delete(key)
        ledger.selected = `f:${key}`
      } else ledger.opened.add(key)
      ledger.notice = undefined
      draw()
    }

    const copy = () => {
      const line = selectedLine()
      if (!line) return
      const snippet = configSnippet(line)
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
      if (ledger.open)
        notice(paused ? "Paused in this project: Trust keeps counting, and answers nothing." : "Resumed.")
      else
        api.ui.toast({
          variant: "info",
          title: "Trust",
          message: paused ? "Paused in this project." : "Answering again in this project.",
        })
    }

    const move = (by: number) => {
      const list = lines()
      ledger.selected = list[Math.max(0, Math.min(list.length - 1, cursor(list) + by))]?.key
      ledger.notice = undefined
      draw()
    }

    const toggleAll = () => {
      ledger.all = !ledger.all
      ledger.notice = undefined
      draw()
    }

    const dialogLayer = (): Layer => ({
      priority: 100,
      commands: [
        { name: "cockpit.trust.down", title: "Next rule", run: () => move(1) },
        { name: "cockpit.trust.up", title: "Previous rule", run: () => move(-1) },
        { name: "cockpit.trust.fold", title: "Open or fold a family", run: () => fold() },
        { name: "cockpit.trust.revoke", title: "Revoke this rule or family", run: () => revoke() },
        { name: "cockpit.trust.widen", title: "Trust the whole family, or undo it", run: () => widen() },
        { name: "cockpit.trust.copy", title: "Copy as config", run: () => copy() },
        { name: "cockpit.trust.togglePause", title: "Pause or resume", run: () => togglePause() },
        { name: "cockpit.trust.all", title: "Show or fold commands approved once", run: () => toggleAll() },
        { name: "cockpit.trust.close", title: "Close", run: () => api.ui.dialog.clear() },
      ],
      bindings: [
        { key: "j,down", cmd: "cockpit.trust.down" },
        { key: "k,up", cmd: "cockpit.trust.up" },
        { key: "return", cmd: "cockpit.trust.fold" },
        { key: "x", cmd: "cockpit.trust.revoke" },
        { key: "w", cmd: "cockpit.trust.widen" },
        { key: "c", cmd: "cockpit.trust.copy" },
        { key: "p", cmd: "cockpit.trust.togglePause" },
        { key: "a", cmd: "cockpit.trust.all" },
        { key: "q", cmd: "cockpit.trust.close" },
      ],
    })

    const openLedger = () => {
      /** Config may have changed since: what the dialog says about "ask" rules should be today's. */
      void loadRules()
      ledger.open = true
      ledger.notice = undefined
      paint()
      api.ui.dialog.replace(
        () => <Ledger api={api} rows={dialogRows} keys={dialogLayer} onScroll={(by) => move(by)} />,
        () => {
          ledger.open = false
        },
      )
      api.ui.dialog.setSize("xlarge")
      log.debug("ledger: open", { lines: lines().length })
    }

    api.keymap.registerLayer({
      commands: [
        {
          name: "cockpit.trust.ledger",
          title: "Trust: what it answers for you",
          category: "Trust",
          namespace: "palette",
          slashName: "trust",
          run: () => openLedger(),
        },
        {
          name: "cockpit.trust.sidebar",
          title: "Trust: show or hide in the sidebar",
          category: "Trust",
          namespace: "palette",
          run: () => {
            inSidebar = !inSidebar
            log.debug("sidebar", { shown: inSidebar })
            paint()
          },
        },
        {
          name: "cockpit.trust.pause",
          title: "Trust: pause or resume in this project",
          category: "Trust",
          namespace: "palette",
          run: () => togglePause(),
        },
      ],
      bindings: keys.gather("cockpit", Object.keys(DEFAULT_KEYS)),
    })

    api.slots.register({
      /** Between Subagents (150) and the shells (170) by default; lower draws first. */
      order: sidebarOrder("trust", 160, config.sidebarOrder, { directory }),
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
