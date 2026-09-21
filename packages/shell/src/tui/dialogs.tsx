/** @jsxImportSource @opentui/solid */

import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { BADGE_LABEL, displayCommand, kindOf, order } from "./lib/view.ts"
import type { ShellStore } from "./state/store.ts"

export function newShell(api: TuiPluginApi, store: ShellStore, open: (id?: string) => void) {
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
            owner: { project: store.project(), session: store.session() },
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

export function restartDaemon(api: TuiPluginApi, store: ShellStore) {
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

/**
 * Stopping shells in bulk. Two commands rather than one, because "everything I can see" and
 * "everything, including what I cannot" are different intentions — and the second one asks first.
 */
export function stopShells(api: TuiPluginApi, store: ShellStore, reach: "view" | "project"): void {
  const list = (reach === "view" ? store.shells() : store.all()).filter((s) => s.status === "running")
  if (list.length === 0) {
    api.ui.toast({ title: "Shells", message: "Nothing is running.", duration: 3000 })
    return
  }

  const stop = () => {
    api.ui.dialog.clear()
    void Promise.all(
      list.map((shell) => store.client.call("shell.stop", { id: shell.id, graceMs: 2000 }).catch(() => {})),
    ).then(() => {
      void store.refresh()
      api.ui.toast({
        title: "Shells",
        message: `Stopped ${list.length} shell${list.length === 1 ? "" : "s"}.`,
        duration: 4000,
      })
    })
  }

  // Shells from other conversations are the ones you are not looking at; say so before killing them.
  const elsewhere =
    reach === "project" ? list.length - store.shells().filter((s) => s.status === "running").length : 0
  if (elsewhere <= 0) {
    stop()
    return
  }

  const DialogConfirm = api.ui.DialogConfirm
  api.ui.dialog.replace(() => (
    <DialogConfirm
      title="Stop every shell in this project?"
      message={`${list.length} running · ${elsewhere} from other conversations.`}
      onConfirm={stop}
      onCancel={() => api.ui.dialog.clear()}
    />
  ))
}

export function pickShell(api: TuiPluginApi, store: ShellStore, open: (id?: string) => void) {
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
