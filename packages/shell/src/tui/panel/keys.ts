/**
 * Which key does what in the console, as a table — Review's `panel/keys.ts`, for Shell. One table for
 * both sizes.
 *
 * A **global** layer, registered only while the console is open: a targeted layer never fires here
 * (the keymap's focus stays on the prompt), so these letters are really taken while it is up and
 * given back the moment it closes. Typing and search take keys before this, in the host's intercept.
 */

import type { Host } from "@opencode-cockpit/client/host"
import type { Actions } from "./actions.ts"

type Layer = Parameters<Host["keymap"]["registerLayer"]>[0]

export function consoleLayer(actions: Actions): Layer {
  return {
    priority: 100,
    commands: [
      { name: "cockpit.console.type", title: "Type into shell", run: () => actions.type() },
      { name: "cockpit.console.interrupt", title: "Send ctrl+c", run: () => actions.interrupt() },
      { name: "cockpit.console.restart", title: "Restart shell", run: () => actions.restart() },
      { name: "cockpit.console.stop", title: "Stop shell", run: () => actions.stop() },
      { name: "cockpit.console.remove", title: "Remove shell", run: () => actions.remove() },
      { name: "cockpit.console.clear", title: "Clear finished shells", run: () => actions.clearFinished() },
      { name: "cockpit.console.view", title: "Screen / log", run: () => actions.swapView() },
      { name: "cockpit.console.search", title: "Search this shell's log", run: () => actions.search() },
      {
        name: "cockpit.console.searchClear",
        title: "Clear the log filter",
        run: () => actions.clearFilter(),
      },
      { name: "cockpit.console.details", title: "Toggle details", run: () => actions.details() },
      { name: "cockpit.console.next", title: "Next shell", run: () => actions.next() },
      { name: "cockpit.console.prev", title: "Previous shell", run: () => actions.prev() },
      { name: "cockpit.console.new", title: "New shell", run: () => actions.newShell() },
      { name: "cockpit.console.scope", title: "This session / whole project", run: () => actions.scope() },
      { name: "cockpit.console.down", title: "Scroll down", run: () => actions.scroll(3) },
      { name: "cockpit.console.up", title: "Scroll up", run: () => actions.scroll(-3) },
      { name: "cockpit.console.bottom", title: "Follow the output", run: () => actions.follow() },
      { name: "cockpit.console.top", title: "Scroll to top", run: () => actions.top() },
      { name: "cockpit.console.full", title: "Full screen / dialog", run: () => actions.resize() },
      { name: "cockpit.console.close", title: "Close console", run: () => actions.close() },
    ],
    bindings: [
      { key: "i,return", cmd: "cockpit.console.type" },
      { key: "c", cmd: "cockpit.console.interrupt" },
      { key: "r", cmd: "cockpit.console.restart" },
      { key: "x", cmd: "cockpit.console.stop" },
      { key: "d", cmd: "cockpit.console.remove" },
      { key: "shift+d", cmd: "cockpit.console.clear" },
      { key: "tab", cmd: "cockpit.console.view" },
      { key: "/", cmd: "cockpit.console.search" },
      { key: "backspace", cmd: "cockpit.console.searchClear" },
      { key: "?,shift+/", cmd: "cockpit.console.details" },
      { key: "],l,right", cmd: "cockpit.console.next" },
      { key: "[,h,left", cmd: "cockpit.console.prev" },
      { key: "n", cmd: "cockpit.console.new" },
      { key: "s", cmd: "cockpit.console.scope" },
      { key: "j,down", cmd: "cockpit.console.down" },
      { key: "k,up", cmd: "cockpit.console.up" },
      { key: "shift+g,end", cmd: "cockpit.console.bottom" },
      { key: "g,home", cmd: "cockpit.console.top" },
      { key: "w", cmd: "cockpit.console.full" },
      { key: "q,escape", cmd: "cockpit.console.close" },
    ],
  }
}
