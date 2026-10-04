/** @jsxImportSource @opentui/solid */

/**
 * Trail's interface half: the sidebar block — what this conversation made, one click from the page —
 * `/trail`, and `/link` for a person to add one by hand.
 *
 * Everything that decides is in `core/`; this file wires it to the host: the trail file read (every
 * window, and the agent half, append to it) and appended (`x`, `/link`), the conversation on
 * screen found, and the two surfaces drawn from the same `arrange` as `trail_list`.
 */

import { claimFeature, duplicateFeatureMessage } from "@opencode-cockpit/client/feature"
import { bindingLookup, dualTui, type Host, type Layer } from "@opencode-cockpit/client/host"
import type { BoxRenderable } from "@opentui/core"
import { createSignal } from "solid-js"
import { loadTrail } from "../core/config.ts"
import { createJournal } from "../core/journal.ts"
import { arrange, conversationThings } from "../core/model.ts"
import { trailPaths } from "../core/paths.ts"
import { type Event, emptyState, type State } from "../core/store.ts"
import { markdownOf } from "../core/text.ts"
import { linkArgs, runAdd } from "../core/tools.ts"
import { type DialogView, dialogRows, type Tab } from "../core/view/dialog.ts"
import type { Row } from "../core/view/rows.ts"
import { type SidebarView, sidebarRows } from "../core/view/sidebar.ts"
import { openUrl } from "./open.ts"
import { createSessions } from "./source.ts"
import { Dialog } from "./view/dialog.tsx"
import { Rows } from "./view/rows.tsx"

const TRAIL_PACKAGE = "@opencode-cockpit/trail"

/** `<leader>f`: free on both OpenCodes (1.18.32's and 2.0.18's defaults) and in Cockpit. */
const DEFAULT_KEYS = {
  "cockpit.trail.open": "<leader>f",
}

/** How often the route is looked at; the trail file is read every few of these. */
const TICK_MS = 1_000
const SYNC_EVERY = 3
/** The host's dialog: as wide as xlarge allows (Shell's console measured it). */
const DIALOG_COLUMNS = 116
const DEPTH = 8

/** Trail's interface half as a factory, so the `opencode-cockpit` bundle can include it. */
export function createTrailTui({ source = TRAIL_PACKAGE }: { source?: string } = {}) {
  return async (api: Host, rawOptions?: unknown) => {
    const log = api.log.child("trail")
    const directory = api.state.path.directory
    const { settings, order, notices } = loadTrail(directory, rawOptions)
    for (const notice of notices) log.warn("settings", { notice })
    if (!settings.enabled) {
      log.info("off by config", { directory })
      return
    }
    const claim = claimFeature(api.renderer, "trail", source)
    if (!claim.active) {
      log.warn("configured twice", { owner: claim.owner, skipped: source })
      api.ui.toast({
        variant: "warning",
        title: "Trail",
        message: duplicateFeatureMessage("Trail", claim.owner, source),
      })
      return
    }
    api.lifecycle.onDispose(() => claim.release())

    const keys = bindingLookup({ ...DEFAULT_KEYS, ...settings.keybinds })
    const paths = trailPaths(directory)
    const journal = createJournal(paths)
    const sessions = createSessions(api, log)
    const project = directory.split(/[\\/]/).filter(Boolean).at(-1) ?? ""
    let state: State = emptyState()
    /** Something you should know about: drawn as a `!` row whatever else the block says. */
    let trouble: string | undefined
    /** Live conversation titles from the host's list, over the ones written down when recording. */
    const titles = new Map<string, string>()

    // --- the conversation on screen ----------------------------------------------------------------

    const parents = new Map<string, string | null>()
    let root: string | undefined
    let routed: string | undefined
    /** The conversation — the root session — of the session on screen; a subagent's view counts as its parent's. */
    const resolve = async (id: string): Promise<string> => {
      let at = id
      for (let hop = 0; hop < DEPTH; hop++) {
        if (!parents.has(at)) {
          const info = await sessions.get(at)
          if (!info) return at
          parents.set(at, info.parentID ?? null)
          if (info.title && !info.parentID) titles.set(info.id, info.title)
        }
        const parent = parents.get(at)
        if (!parent) return at
        at = parent
      }
      return at
    }
    const follow = () => {
      const route = api.route.current
      const id = route.name === "session" ? (route.params?.sessionID as string | undefined) : undefined
      if (id === routed) return
      routed = id
      if (!id) {
        root = undefined
        return draw()
      }
      void resolve(id).then((found) => {
        if (routed !== id) return
        root = found
        draw()
      })
    }

    // --- painting ----------------------------------------------------------------------------------

    const [sidebarLines, setLines] = createSignal<readonly Row[]>([])
    const [dialogLines, setDialogLines] = createSignal<readonly Row[]>([])
    let block: BoxRenderable | undefined
    let drawnAt = 0
    let said = ""
    let sidebarView: SidebarView = { rows: [], hits: [] }
    const sidebarWidth = () => {
      /** The container the host gave the block, as Subagents measures it: the block's own width follows its rows. */
      const parent = (block?.parent as { width?: number } | null | undefined)?.width ?? 0
      const own = block?.width ?? 0
      const measured = parent >= 12 ? Math.min(parent, own >= 12 ? own : parent) : own
      return measured >= 12 ? measured : Math.max(20, Math.min(40, Math.floor(api.renderer.width / 4) - 2))
    }

    /** `/trail`: which tab, what is under the cursor, and the search. */
    const dialog = {
      open: false,
      tab: "this" as Tab,
      selected: undefined as string | undefined,
      query: "",
      searching: false,
    }
    let shown: DialogView | undefined

    /** Not remembered across restarts: remembered UI state makes a command look dead (gotchas.md). */
    let inSidebar = settings.sidebar
    const paint = () => {
      drawnAt = sidebarWidth()
      const now = Date.now()
      const warnings = [...notices, ...(trouble ? [trouble] : [])]
      const mine = arrange(root ? conversationThings(state, root) : [])
      /** Hidden, the block says nothing — except a notice or trouble: a failure always speaks. */
      sidebarView = inSidebar
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
          state,
          session: root ?? "",
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

    // --- the trail file ----------------------------------------------------------------------------

    /** The host's live titles over the written ones: a conversation renamed since still reads right. */
    const retitle = () => {
      for (const [id, title] of titles) {
        const conversation = state.conversations.get(id)
        if (conversation) conversation.title = title
      }
    }
    const sync = async () => {
      try {
        const before = state.seen.size
        state = await journal.sync(state)
        if (trouble?.startsWith("trail unreadable")) trouble = undefined
        if (state.seen.size !== before) {
          retitle()
          draw()
        }
      } catch (error) {
        log.error("trail unreadable", { file: paths.events, error })
        trouble = "trail unreadable — see cockpit.log"
        draw()
      }
    }
    const write = async (events: readonly Event[]): Promise<boolean> => {
      try {
        await journal.append(events)
        if (trouble?.startsWith("trail not saved")) trouble = undefined
        await sync()
        /** `runAdd` folded the event in already, so the read finds nothing new to draw for: draw anyway. */
        draw()
        return true
      } catch (error) {
        log.error("trail not saved", { file: paths.events, error })
        trouble = `trail not saved: ${(error as NodeJS.ErrnoException).code ?? "error"}`
        draw()
        return false
      }
    }

    // --- acting ------------------------------------------------------------------------------------

    const toast = (message: string, variant: "info" | "success" | "warning" | "error" = "info") =>
      api.ui.toast({ variant, title: "Trail", message })

    const open = (url: string) => {
      log.debug("open", { url })
      openUrl(url, (why) => {
        log.warn("open failed", { url, why })
        toast(`Could not open the link (${why}). It is: ${url}`, "warning")
      })
    }

    const copy = (text: string, what: string) => {
      const ok = api.renderer.copyToClipboardOSC52?.(text) ?? false
      if (ok) toast(`Copied ${what}.`, "success")
      else toast(`This terminal refused the clipboard. ${what}: ${text}`, "warning")
    }

    /** Recorded by you, with `/link`, through the agent's own door, `runAdd`. */
    const addByYou = async (args: { title: string; url: string }): Promise<string | undefined> => {
      if (!root) {
        toast("Open a conversation first: a link belongs to the conversation it was made in.", "warning")
        return undefined
      }
      await sync()
      const title = titles.get(root) ?? (await sessions.get(root))?.title
      const out = runAdd(state, args, {
        session: root,
        rootSession: root,
        ...(title ? { sessionTitle: title } : {}),
        by: "you",
        at: Date.now(),
      })
      if (!out.ok) {
        toast(out.text, "warning")
        return undefined
      }
      if (!(await write([out.event]))) {
        toast("The trail could not be saved — see cockpit.log.", "error")
        return undefined
      }
      log.info("added by you", { session: root, url: out.event.url })
      toast(out.text.split("\n")[0] ?? "Recorded.", "success")
      return out.thing.key
    }

    const link = async () => {
      if (!root) {
        toast("Open a conversation first: a link belongs to the conversation it was made in.", "warning")
        return
      }
      const text = await api.ui.prompt({
        title: "Add a link to this conversation's trail",
        description: "The link, then a note if you like: https://… what it is",
        placeholder: "https://github.com/acme/web/pull/40 the checkout fix",
      })
      if (text === undefined) return
      const args = linkArgs(text)
      if (!args) return toast("Nothing added: paste a link first, then a note if you like.", "warning")
      await addByYou(args)
    }

    // --- /trail ------------------------------------------------------------------------------------

    /** Live titles for All conversations: written-down titles can be a conversation's first, placeholder one. */
    const listTitles = () =>
      sessions
        .list()
        .then((list) => {
          for (const each of list) if (each.title) titles.set(each.id, each.title)
          retitle()
          draw()
        })
        .catch((error) => log.debug("session list failed", { error }))

    const move = (by: number) => {
      const items = shown?.items ?? []
      const at = Math.max(
        0,
        items.findIndex((item) => item.key === dialog.selected),
      )
      dialog.selected = items[Math.max(0, Math.min(items.length - 1, at + by))]?.key
      draw()
    }

    const target = () => shown?.target ?? {}

    const enter = () => {
      const url = target().open
      if (url) open(url)
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
      const record = key ? state.records.get(key) : undefined
      if (!key || !record) return
      const ok = await write([
        {
          v: 1,
          at: Date.now(),
          id: `rm_${key}_${Date.now().toString(36)}`,
          type: "removed",
          record: key,
          rootSession: record.session,
        },
      ])
      if (ok) toast(`Removed "${record.title}" from the trail.`, "success")
    }

    const markdown = () => {
      const arranged = shown?.arranged
      if (!arranged || arranged.total === 0) return toast("Nothing to copy yet: the trail is empty.", "info")
      copy(markdownOf(arranged), `${arranged.shown} ${arranged.shown === 1 ? "thing" : "things"} as markdown`)
    }

    const switchTab = () => {
      dialog.tab = dialog.tab === "this" ? "all" : "this"
      dialog.selected = undefined
      if (dialog.tab === "all") void listTitles()
      draw()
    }

    /** A click on a row takes the cursor; on the row already under it, `enter`. */
    const click = (_x: number, y: number) => {
      const hit = shown?.hits.find((each) => each.y === y)
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
          run: run(() => target().copy && copy(target().copy as string, "the link")),
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

    /**
     * Ahead of the keymap, because the host's dialog takes `esc` before any layer hears it (Trust's
     * filter does the same): the search being typed gets every key, and `esc` clears a search before
     * the host closes the dialog.
     */
    api.lifecycle.onDispose(
      api.keymap.intercept(
        (ctx) => {
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
        },
        { priority: 10_000 },
      ),
    )

    const openDialog = (at: Partial<typeof dialog> = {}) => {
      Object.assign(dialog, {
        open: true,
        /** With no conversation on screen there is no "this": the project's trail. */
        tab: root ? (at.tab ?? "this") : "all",
        selected: at.selected,
        query: at.query ?? "",
        searching: false,
      })
      void sync()
      if (dialog.tab === "all") void listTitles()
      paint()
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
      log.debug("trail: open", { tab: dialog.tab, items: shown?.items.length ?? 0 })
    }

    // --- the sidebar -------------------------------------------------------------------------------

    /** A row with a page opens it; one without opens `/trail` on it; `+ N more` opens `/trail`. */
    const sidebarClick = (y: number) => {
      const hit = sidebarView.hits.find((each) => each.y === y)
      if (!hit) return
      if (hit.kind === "open") open(hit.url)
      else if (hit.kind === "select") openDialog({ selected: hit.key })
      else openDialog()
    }

    api.keymap.registerLayer({
      commands: [
        {
          name: "cockpit.trail.open",
          title: "Show what this conversation made",
          category: "Cockpit · Trail",
          namespace: "palette",
          slashName: "trail",
          run: () => openDialog(),
        },
        {
          name: "cockpit.trail.link",
          title: "Add a link to this conversation's trail",
          desc: "a PR, a ticket, a page",
          category: "Cockpit · Trail",
          namespace: "palette",
          slashName: "link",
          run: () => void link().catch((error) => log.warn("link failed", { error })),
        },
        {
          name: "cockpit.trail.copyAll",
          title: "Copy this conversation's trail as markdown",
          category: "Cockpit · Trail",
          namespace: "palette",
          run: () => {
            const arranged = arrange(root ? conversationThings(state, root) : [])
            if (arranged.total === 0)
              return toast(
                root
                  ? "Nothing to copy yet: this conversation's trail is empty."
                  : "Open a conversation first.",
              )
            copy(
              markdownOf(arranged),
              `${arranged.total} ${arranged.total === 1 ? "thing" : "things"} as markdown`,
            )
          },
        },
        {
          name: "cockpit.trail.sidebar",
          title: "Show or hide Trail in the sidebar",
          desc: "for this session",
          category: "Cockpit · Trail",
          namespace: "palette",
          run: () => {
            inSidebar = !inSidebar
            paint()
            /** Said as well as drawn: on the home screen there is no sidebar to show it in. */
            toast(inSidebar ? "Shown in the sidebar." : "Hidden from the sidebar.")
          },
        },
      ],
      bindings: keys.gather("cockpit", Object.keys(DEFAULT_KEYS)),
    })

    api.slots.register({
      /** After Shells and before Trust by default; the top-level `sidebar` list moves it. */
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
            onRow={(y) => sidebarClick(y)}
          />
        ),
      },
    })

    let ticks = 0
    let ticking: ReturnType<typeof setInterval> | undefined = setInterval(() => {
      follow()
      if (++ticks % SYNC_EVERY === 0) void sync()
      /** The sidebar was laid out, or resized, since the rows were drawn. */
      if (sidebarWidth() !== drawnAt) draw()
    }, TICK_MS)
    api.lifecycle.onDispose(() => {
      clearInterval(ticking)
      ticking = undefined
    })

    follow()
    await sync()
    draw()
    log.info("ready", { trail: paths.events, sidebar: inSidebar, order })
  }
}

/** One entry for both OpenCodes: v1 calls `tui`, v2 calls `setup` (docs/opencode/v2.md). */
export default dualTui("opencode-cockpit.trail", createTrailTui())
