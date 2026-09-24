import type { Host } from "@opencode-cockpit/client/host"
import { order, shellListItem } from "./lib/view.ts"
import type { ShellStore } from "./state/store.ts"

/**
 * The dialogs are the host's own — a prompt, a confirmation, a list — reached through `Host`, so the
 * same code opens v1's components and v2's promise dialogs.
 */
export function newShell(api: Host, store: ShellStore, open: (id?: string) => void) {
  void api.ui.prompt({ title: "New background shell", placeholder: "npm run dev" }).then((value) => {
    const command = value?.trim()
    if (!command) return
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
        api.ui.toast({
          variant: "error",
          title: "Shell",
          message: err instanceof Error ? err.message : String(err),
        })
      })
  })
}

export function restartDaemon(api: Host, store: ShellStore) {
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
  void api.ui
    .confirm({
      title: "Restart shell daemon?",
      message: `${running} running shell${running === 1 ? "" : "s"} will be stopped.`,
    })
    .then((yes) => {
      if (yes) restart(true)
    })
}

/**
 * Stopping shells in bulk. Two commands rather than one, because "everything I can see" and
 * "everything, including what I cannot" are different intentions — and the second one asks first.
 */
export function stopShells(api: Host, store: ShellStore, reach: "view" | "project"): void {
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

  void api.ui
    .confirm({
      title: "Stop every shell in this project?",
      message: `${list.length} running · ${elsewhere} from other conversations.`,
    })
    .then((yes) => {
      if (yes) stop()
    })
}

/**
 * `/shells`: every shell in view, and a way to start one — the same list whatever is running.
 *
 * It used to toggle the dock, while `/shell` opened whichever shell was last selected; with several
 * running, reaching a particular one meant opening the wrong one first. A list always, with "new" at
 * the top, is one path to every shell.
 */
const NEW_SHELL = "\0new"

export function pickShell(api: Host, store: ShellStore, open: (id?: string) => void) {
  /** Every shell in the project: this is where you go to find one, whichever conversation started it. */
  const shells = order(store.all())
  void api.ui
    .select<string>({
      title: "Shells",
      placeholder: "Search shells",
      current: store.selected()?.id ?? NEW_SHELL,
      options: [
        {
          title: "+ New shell",
          value: NEW_SHELL,
          description: "run a command in the background",
          category: "Start",
        },
        ...shells.map((s) => {
          const item = shellListItem(s, store.now(), store.project())
          return {
            title: item.title,
            value: s.id,
            description: item.description,
            category: item.category,
            footer: `● ${item.status}`,
          }
        }),
      ],
    })
    .then((value) => {
      if (value === undefined) return
      if (value === NEW_SHELL) newShell(api, store, open)
      else open(value)
    })
}
