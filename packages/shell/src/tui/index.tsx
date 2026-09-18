/** @jsxImportSource @opentui/solid */
import {
  createBindingLookup,
  type TuiPlugin,
  type TuiPluginApi,
  type TuiPluginModule,
} from "@opencode-ai/plugin/tui"
import { claimFeature, duplicateFeatureMessage } from "@opencode-cockpit/client"
import { createSignal } from "solid-js"
import { createClient } from "../connect.ts"
import { Console } from "./console.tsx"
import { Dock } from "./dock.tsx"
import { SidebarShells } from "./sidebar.tsx"
import { createShellStore, type ShellStore } from "./store.ts"
import { BADGE_LABEL, displayCommand, kindOf, order } from "./view.ts"

const DEFAULT_KEYS = {
  "cockpit.shells.dock": "<leader>o",
  "cockpit.shells.console": "<leader>i",
}

export interface ShellTuiOptions {
  dockHeight?: number
  /** Shell rows the sidebar shows before folding the rest away (default 5). */
  sidebarRows?: number
  /** Failures stay visible this long after they end (default 30). */
  historyMinutes?: number
  dockOpen?: boolean
  keybinds?: Record<string, string>
}

const SHELL_PACKAGE = "@opencode-cockpit/shell"

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

const shellTui: TuiPlugin = async (api, rawOptions) => {
  const options = (rawOptions ?? {}) as ShellTuiOptions
  const client = createClient("opencode-cockpit/tui")
  const store = createShellStore(api, client, { historyMinutes: options.historyMinutes })
  const keys = createBindingLookup({ ...DEFAULT_KEYS, ...options.keybinds })

  const [dockOpen, setDockOpen] = createSignal<boolean>(
    api.kv.get("cockpit.dock.open", options.dockOpen ?? false),
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

function newShell(api: TuiPluginApi, store: ShellStore, open: (id?: string) => void) {
  const DialogPrompt = api.ui.DialogPrompt
  api.ui.dialog.replace(() => (
    <DialogPrompt
      title="New background shell"
      placeholder="npm run dev"
      onConfirm={(value) => {
        const command = value.trim()
        if (!command) return api.ui.dialog.clear()
        const shell =
          process.env.SHELL && /(bash|zsh|fish|sh)$/.test(process.env.SHELL) ? process.env.SHELL : "/bin/bash"
        store.client
          .call("shell.start", {
            command: shell,
            args: ["-c", command],
            cwd: store.project(),
            title: command.slice(0, 60),
            owner: { project: store.project() },
            reuse: true,
          })
          .then((info) => {
            void store.refresh()
            open(info.id)
          })
          .catch((err) => {
            api.ui.dialog.clear()
            api.ui.toast({
              variant: "error",
              title: "Shell",
              message: err instanceof Error ? err.message : String(err),
            })
          })
      }}
      onCancel={() => api.ui.dialog.clear()}
    />
  ))
}

function restartDaemon(api: TuiPluginApi, store: ShellStore) {
  const running = store.shells().filter((s) => s.status === "running").length
  const restart = (force: boolean) => {
    api.ui.dialog.clear()
    store.client
      .restartDaemon({ force })
      .then((ok) => {
        void store.refresh()
        api.ui.toast({
          variant: ok ? "success" : "warning",
          title: "Shells",
          message: ok ? "Shell daemon restarted" : "Shells are running; restart was not forced",
        })
      })
      .catch((err) => api.ui.toast({ variant: "error", title: "Shells", message: String(err) }))
  }
  if (running === 0) return restart(false)
  const DialogConfirm = api.ui.DialogConfirm
  api.ui.dialog.replace(() => (
    <DialogConfirm
      title="Restart shell daemon?"
      message={`${running} running shell${running === 1 ? "" : "s"} will be stopped.`}
      onConfirm={() => restart(true)}
      onCancel={() => api.ui.dialog.clear()}
    />
  ))
}

function pickShell(api: TuiPluginApi, store: ShellStore, open: (id?: string) => void) {
  const DialogSelect = api.ui.DialogSelect
  const shells = order(store.shells())
  if (shells.length === 0) {
    api.ui.toast({ variant: "info", title: "Shells", message: "No shells in this project yet" })
    return
  }
  api.ui.dialog.replace(() => (
    <DialogSelect
      title="Shells"
      current={store.selected()?.id}
      options={shells.map((s) => ({
        title: s.title,
        value: s.id,
        description: `${BADGE_LABEL[kindOf(s)]} · ${displayCommand(s).slice(0, 60)}`,
      }))}
      onSelect={(option) => open(option.value as string)}
    />
  ))
}

const plugin: TuiPluginModule & { id: string } = { id: "opencode-cockpit.shell", tui: createShellTui() }
export default plugin
