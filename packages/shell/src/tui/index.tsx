/** @jsxImportSource @opentui/solid */

import { claimFeature, duplicateFeatureMessage } from "@opencode-cockpit/client"
import { bindingLookup, dualTui, type Host } from "@opencode-cockpit/client/host"
import { sidebarOrder } from "@opencode-cockpit/client/sidebar"
import type { BoxRenderable } from "@opentui/core"
import { createSignal } from "solid-js"
import { createClient } from "../connect.ts"
import { type CockpitConfig, loadConfig } from "../core/config.ts"
import { Console } from "./components/console.tsx"
import { Dock } from "./components/dock.tsx"
import { SidebarShells } from "./components/sidebar.tsx"
import { newShell, pickShell, restartDaemon, stopShells } from "./dialogs.tsx"
import { screenCols } from "./lib/console.ts"
import { isReleaseKey, keyToBytes } from "./lib/keys.ts"
import { createActions, HISTORY } from "./panel/actions.ts"
import { createFeed } from "./panel/feed.ts"
import { consoleLayer } from "./panel/keys.ts"
import { createPainter } from "./panel/paint.ts"
import { createSurface } from "./panel/surface.ts"
import { createShellStore } from "./state/store.ts"
import { Overlay } from "./view/overlay.tsx"
import { createRowPool, type RowPool } from "./view/pool.ts"

const DEFAULT_KEYS = {
  "cockpit.shells.dock": "<leader>o",
  "cockpit.shells.console": "<leader>i",
}

/** Interface settings; the `ui` section of the config file (see core/config.ts). */
export type ShellTuiOptions = NonNullable<CockpitConfig["ui"]>

const SHELL_PACKAGE = "@opencode-cockpit/shell"

/** Shell's TUI half as a factory, so bundles such as `opencode-cockpit` can include it. */
export function createShellTui({ source = SHELL_PACKAGE }: { source?: string } = {}) {
  return async (api: Host, rawOptions?: unknown) => {
    // The renderer is shared by every TUI plugin in this OpenCode window.
    const claim = claimFeature(api.renderer, "shell", source)
    if (!claim.active) {
      api.ui.toast({
        variant: "warning",
        title: "opencode-cockpit",
        message: duplicateFeatureMessage("Shell", claim.owner, source),
        duration: 10_000,
      })
      return
    }
    api.lifecycle.onDispose(() => claim.release())
    await shellTui(api, rawOptions)
  }
}

const shellTui = async (api: Host, rawOptions?: unknown) => {
  // Settings come from the shared config file; plugin-entry options still win, flat or under "ui".
  const log = api.log.child("shell")
  const config = loadConfig(api.state.path.directory, rawOptions)
  const options: ShellTuiOptions = config.ui ?? {}
  const client = createClient("opencode-cockpit/tui")
  const store = createShellStore(api, client, { historyMinutes: options.historyMinutes })
  const keys = bindingLookup({ ...DEFAULT_KEYS, ...options.keybinds })

  // An explicit `ui.dockOpen` says how the panel should start; without one, whatever you last left
  // it as. Remembered state that overrides a written setting is a setting that appears to do nothing.
  const [dockOpen, setDockOpen] = createSignal<boolean>(
    options.dockOpen ?? api.kv.get("cockpit.dock.open", false),
  )
  const toggleDock = () => {
    const next = !dockOpen()
    setDockOpen(next)
    api.kv.set("cockpit.dock.open", next)
  }
  const shortcut = (command: string) => api.keymap.shortcut(command)

  /**
   * The console: one surface, one feed, one painter, one key table — at two sizes.
   *
   * The dialog and full screen were two implementations and drifted within a day. Now both draw
   * `consoleRows` from the same state; the dialog renders them in the host's dialog, full screen
   * assigns them onto lines in a slot (Review's pattern — a slot is drawn once). `w` only changes the
   * size, and full screen is remembered for next time.
   */
  const FULL_KEY = "cockpit.console.full"
  const surface = createSurface(options.defaultView ?? "screen")
  surface.full = api.kv.get(FULL_KEY, false)
  let backdrop: BoxRenderable | undefined
  let pool: RowPool | undefined
  let disposeKeys: (() => void) | undefined
  /** Bumped on every paint while the dialog shows; the dialog is the one place that re-renders. */
  const [version, setVersion] = createSignal(0)
  /** The dialog is being swapped for full screen or back: its closing is not the console closing. */
  let swapping = false
  /** Our dialog is the one on screen — not the new-shell prompt or the list that led here. */
  let showing = false

  /** What the daemon says is on screen: events and callbacks, never effects (see `panel/feed.ts`). */
  let seen = 0
  const feed = createFeed(client, () => {
    /** Scrolled up, new output must not drag the view along: follow the rows as they scroll off. */
    const history = feed.screen()?.history ?? 0
    if (surface.up > 0 && seen > 0 && history > seen) surface.up += history - seen
    seen = history
    surface.log = feed.log()
    painter.draw()
  })
  const painter = createPainter({
    api,
    store,
    surface,
    feed,
    colors: options.colors !== false,
    boxes: () => ({ ...(backdrop ? { backdrop } : {}), ...(pool ? { pool } : {}) }),
    dialogChanged: () => setVersion((v) => v + 1),
  })
  /** The clock and the spinner, while the console is up — Review's `watching`. */
  let ticking: ReturnType<typeof setInterval> | undefined

  let typing = false
  /** Every change ends here: the feed learns what to follow, then one paint. */
  const draw = () => {
    const selected = store.selected()
    if (surface.typing && selected?.status !== "running") surface.typing = false
    feed.follow(surface.open ? selected?.id : undefined, selected?.bytes)
    /** Enough scrollback to fill the body, or all of it while scrolled up. */
    feed.setHistory(surface.open ? (surface.up > 0 ? HISTORY : painter.body()) : 0)
    feed.setLog(surface.open && surface.view === "log", surface.filter)
    // Typing starts: size the program to what the console shows, at whichever size it has.
    if (surface.typing && !typing && selected) {
      void client
        .call("shell.resize", {
          id: selected.id,
          cols: screenCols(painter.size().width),
          rows: painter.body(),
        })
        .catch(() => {})
    }
    typing = surface.typing
    painter.draw()
  }

  const showDialog = () => {
    /** Replacing a dialog runs the old one's close handler: that is not the console closing. */
    swapping = true
    api.ui.dialog.replace(
      () => (
        <Console
          api={api}
          rows={() => {
            version()
            return painter.rows()
          }}
          keys={() => ({
            ...consoleLayer(actions),
            enabled: () => !surface.typing && !surface.searching,
          })}
        />
      ),
      /** Closed by the host — escape, a click outside — is the console closing, unless we swapped. */
      () => {
        showing = false
        if (surface.open && !surface.full && !swapping) closeConsole()
      },
    )
    api.ui.dialog.setSize("xlarge")
    showing = true
    swapping = false
  }

  const closeConsole = () => {
    if (!surface.open) return
    log.debug("console: close", { full: surface.full })
    Object.assign(surface, { open: false, typing: false, searching: false, notice: undefined })
    disposeKeys?.()
    disposeKeys = undefined
    clearInterval(ticking)
    ticking = undefined
    backdrop?.blur()
    if (!surface.full) {
      swapping = true
      api.ui.dialog.clear()
      swapping = false
    }
    draw()
    /** The prompt wants its cursor back, exactly where the host had it. */
    const at = api.renderer.getCursorState?.()
    if (at) api.renderer.setCursorPosition(at.x, at.y, true)
  }

  /** `w`: the same console, the other size. */
  const resizeConsole = () => {
    swapping = true
    surface.full = !surface.full
    api.kv.set(FULL_KEY, surface.full)
    log.debug("console: resize", { full: surface.full })
    if (surface.full) {
      api.ui.dialog.clear()
      disposeKeys ??= api.keymap.registerLayer(consoleLayer(actions))
      /** As Review's show does: focus leaves the prompt, and its cursor stops blinking through. */
      backdrop?.focus()
    } else {
      disposeKeys?.()
      disposeKeys = undefined
      backdrop?.blur()
      showDialog()
    }
    swapping = false
    draw()
  }

  const actions = createActions({
    store,
    surface,
    draw,
    most: () => painter.most(),
    close: closeConsole,
    resize: resizeConsole,
    newShell: () => newShell(api, store, openConsole),
  })

  /** Search and typing take keys before the layer: a query or a program must get every key. */
  api.keymap.intercept(
    (ctx) => {
      if (!surface.open) return
      const event = ctx.event
      if (surface.searching) {
        ctx.consume({ preventDefault: true, stopPropagation: true })
        if (event.name === "escape") {
          surface.searching = false
          return draw()
        }
        if (event.name === "return" || event.name === "enter") {
          Object.assign(surface, { filter: surface.draft.trim(), searching: false })
          return draw()
        }
        if (event.name === "backspace") surface.draft = surface.draft.slice(0, -1)
        else if (event.sequence && !event.ctrl && !event.meta && event.sequence >= " ")
          surface.draft += event.sequence
        return draw()
      }
      if (!surface.typing) return
      ctx.consume({ preventDefault: true, stopPropagation: true })
      if (isReleaseKey(event)) {
        surface.typing = false
        return draw()
      }
      const bytes = keyToBytes(event)
      const shell = store.selected()?.id
      if (bytes && shell) void client.call("shell.write", { id: shell, data: bytes }).catch(() => {})
    },
    { priority: 10_000 },
  )

  const openConsole = (id?: string, typeInto = false) => {
    if (id) store.select(id)
    log.debug("console: open", { id, full: surface.full })
    const already = surface.open
    Object.assign(surface, {
      open: true,
      up: 0,
      typing: typeInto,
      searching: false,
      notice: undefined,
      ...(already ? {} : { view: options.defaultView ?? "screen" }),
    })
    ticking ??= setInterval(draw, 120)
    /** Full screen takes keys with a global layer; the dialog registers the same table itself. */
    if (surface.full) disposeKeys ??= api.keymap.registerLayer(consoleLayer(actions))
    if (surface.full) {
      /** Whatever dialog led here — the new-shell prompt, the list — goes, or it sits over the console. */
      swapping = true
      api.ui.dialog.clear()
      swapping = false
      backdrop?.focus()
    } else if (!already || api.ui.dialog.depth === 0 || !showing) showDialog()
    draw()
  }

  api.keymap.registerLayer({
    commands: [
      {
        name: "cockpit.shells.dock",
        title: "Toggle shells panel",
        category: "Shells",
        namespace: "palette",
        slashName: "shells-dock",
        run: () => toggleDock(),
      },
      {
        name: "cockpit.shells.console",
        title: "Open shell console",
        category: "Shells",
        namespace: "palette",
        slashName: "shell",
        run: () => openConsole(),
      },
      {
        name: "cockpit.shells.new",
        title: "New background shell",
        category: "Shells",
        namespace: "palette",
        slashName: "shell-new",
        run: () => newShell(api, store, openConsole),
      },
      {
        name: "cockpit.shells.stop",
        title: "Stop the shells in view",
        category: "Shells",
        namespace: "palette",
        slashName: "shells-stop",
        run: () => stopShells(api, store, "view"),
      },
      {
        name: "cockpit.shells.stopAll",
        title: "Stop every shell in this project",
        category: "Shells",
        namespace: "palette",
        slashName: "shells-stop-all",
        run: () => stopShells(api, store, "project"),
      },
      {
        name: "cockpit.shells.clear",
        title: "Clear finished shells",
        category: "Shells",
        namespace: "palette",
        slashName: "shells-clear",
        run: () => {
          void store
            .clearFinished()
            .then((n) =>
              api.ui.toast({
                variant: "success",
                title: "Shells",
                message: `Cleared ${n} finished shell${n === 1 ? "" : "s"}`,
              }),
            )
            .catch((error) => {
              log.error("clear failed", { error })
              api.ui.toast({ variant: "error", title: "Shells", message: String(error) })
            })
        },
      },
      {
        name: "cockpit.shells.restartDaemon",
        title: "Restart shell daemon",
        category: "Shells",
        namespace: "palette",
        slashName: "shells-restart-daemon",
        run: () => restartDaemon(api, store),
      },
      {
        name: "cockpit.shells.pick",
        title: "Shells: pick one, or start a new one",
        category: "Shells",
        namespace: "palette",
        slashName: "shells",
        run: () => pickShell(api, store, openConsole),
      },
    ],
    bindings: keys.gather("cockpit", Object.keys(DEFAULT_KEYS)),
  })

  const height = () => Math.max(6, Math.min(options.dockHeight ?? 14, Math.floor(api.renderer.height * 0.45)))

  api.slots.register({
    /** Above the statusline (200) at the foot of the window: the line stays the very last thing. */
    order: 150,
    slots: {
      app_bottom() {
        return (
          <>
            {dockOpen() ? (
              <Dock
                api={api}
                store={store}
                height={height()}
                colors={options.colors}
                hint={() =>
                  `${shortcut("cockpit.shells.console")} console · ${shortcut("cockpit.shells.dock")} hide`
                }
                onOpenConsole={(id) => openConsole(id)}
              />
            ) : null}
            <Overlay
              api={api}
              onReady={(parts) => {
                backdrop = parts.backdrop
                pool = createRowPool(parts.lines)
                log.debug("full: mounted")
                draw()
              }}
              onScroll={(delta) => actions.scroll(delta)}
            />
          </>
        )
      },
    },
  })

  api.slots.register({
    /**
     * The sidebar on its own: its place there (statusline, subagents, then shells — `"sidebar"` in
     * Cockpit's config moves it) is not the dock's place at the foot of the window.
     */
    order: sidebarOrder("shell", 170, options.sidebarOrder, { directory: api.state.path.directory }),
    slots: {
      sidebar_content() {
        return (
          <SidebarShells
            api={api}
            store={store}
            rows={options.sidebarRows}
            onOpen={(id) => openConsole(id)}
            consoleShortcut={() => shortcut("cockpit.shells.console")}
          />
        )
      },
    },
  })

  // OpenCode never re-resolves an installed plugin spec, so check for a newer release ourselves.

  // A daemon from older plugin code is kept only while it runs shells; say so once.
  const offOutdated = client.onOutdated((info) => {
    if (!info) return
    api.ui.toast({
      variant: "warning",
      title: "Shells",
      message:
        "The shell daemon is running older code because shells are still running. Run /shells-restart-daemon when convenient.",
      duration: 8000,
    })
  })

  api.lifecycle.onDispose(() => {
    feed.dispose()
    clearInterval(ticking)
    offOutdated()
    store.dispose()
    client.close()
  })
}

/** One entry for both OpenCodes: v1 calls `tui`, v2 calls `setup` (docs/opencode/v2.md). */
export default dualTui("opencode-cockpit.shell", createShellTui())
