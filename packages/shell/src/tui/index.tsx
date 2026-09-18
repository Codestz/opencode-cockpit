/** @jsxImportSource @opentui/solid */

import { createBindingLookup, type TuiPlugin, type TuiPluginModule } from "@opencode-ai/plugin/tui"
import { claimFeature, duplicateFeatureMessage } from "@opencode-cockpit/client"
import { createSignal } from "solid-js"
import pkg from "../../package.json" with { type: "json" }
import { createClient } from "../connect.ts"
import { type CockpitConfig, loadConfig } from "../core/config.ts"
import { Console } from "./components/console.tsx"
import { Dock } from "./components/dock.tsx"
import { SidebarShells } from "./components/sidebar.tsx"
import { announceUpdate, newShell, offerUpdate, pickShell, restartDaemon } from "./dialogs.tsx"
import { createShellStore } from "./state/store.ts"

const DEFAULT_KEYS = {
  "cockpit.shells.dock": "<leader>o",
  "cockpit.shells.console": "<leader>i",
}

/** Interface settings; the `ui` section of the config file (see core/config.ts). */
export type ShellTuiOptions = NonNullable<CockpitConfig["ui"]>

const SHELL_PACKAGE = "@opencode-cockpit/shell"
const _PACKAGE_NAME = pkg.name

/** Shell's TUI half as a factory, so bundles such as `opencode-cockpit` can include it. */
export function createShellTui({ source = SHELL_PACKAGE }: { source?: string } = {}): TuiPlugin {
  return async (api, rawOptions, meta) => {
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
    await shellTui(api, rawOptions, meta)
  }
}

const shellTui: TuiPlugin = async (api, rawOptions, meta) => {
  // Settings come from the shared config file; plugin-entry options still win, flat or under "ui".
  const config = loadConfig(api.state.path.directory, rawOptions)
  const options: ShellTuiOptions = config.ui ?? {}
  const client = createClient("opencode-cockpit/tui")
  const store = createShellStore(api, client, { historyMinutes: options.historyMinutes })
  const keys = createBindingLookup({ ...DEFAULT_KEYS, ...options.keybinds })

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
  const shortcut = (command: string) => {
    const bindings = api.keymap.getCommandBindings({ visibility: "registered", commands: [command] })
    return api.keys.formatBindings(bindings.get(command)) ?? ""
  }

  const openConsole = (id?: string, typing = false) => {
    if (id) store.select(id)
    api.ui.dialog.replace(
      () => (
        <Console
          api={api}
          store={store}
          typing={typing}
          colors={options.colors}
          defaultView={options.defaultView}
          onClose={() => api.ui.dialog.clear()}
          onNewShell={() => newShell(api, store, openConsole)}
        />
      ),
      () => {},
    )
    api.ui.dialog.setSize("xlarge")
  }

  api.keymap.registerLayer({
    commands: [
      {
        name: "cockpit.shells.dock",
        title: "Toggle shells panel",
        category: "Shells",
        namespace: "palette",
        slashName: "shells",
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
        name: "cockpit.shells.stopAll",
        title: "Stop all running shells",
        category: "Shells",
        namespace: "palette",
        slashName: "shells-stop-all",
        run: () => {
          const running = store.shells().filter((s) => s.status === "running")
          if (running.length === 0) {
            return api.ui.toast({ title: "Shells", message: "Nothing is running.", duration: 3000 })
          }
          void Promise.all(
            running.map((s) => client.call("shell.stop", { id: s.id, graceMs: 2000 }).catch(() => {})),
          ).then(() =>
            api.ui.toast({
              title: "Shells",
              message: `Stopped ${running.length} shell${running.length === 1 ? "" : "s"}.`,
              duration: 4000,
            }),
          )
        },
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
            .catch((err) => api.ui.toast({ variant: "error", title: "Shells", message: String(err) }))
        },
      },
      {
        name: "cockpit.shells.update",
        title: "Update opencode-cockpit",
        category: "Shells",
        namespace: "palette",
        slashName: "cockpit-update",
        run: () => offerUpdate(api, meta, pkg.version),
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
        title: "Switch shell",
        category: "Shells",
        namespace: "palette",
        run: () => pickShell(api, store, openConsole),
      },
    ],
    bindings: keys.gather("cockpit", Object.keys(DEFAULT_KEYS)),
  })

  const height = () => Math.max(6, Math.min(options.dockHeight ?? 14, Math.floor(api.renderer.height * 0.45)))

  api.slots.register({
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
          </>
        )
      },
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
  if (options.updateCheck !== false) void announceUpdate(api, meta, pkg.version)

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
    offOutdated()
    store.dispose()
    client.close()
  })
}

const plugin: TuiPluginModule & { id: string } = { id: "opencode-cockpit.shell", tui: createShellTui() }
export default plugin
