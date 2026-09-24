/**
 * What the daemon says is on screen, for the full-screen console — events and plain callbacks, no
 * Solid.
 *
 * The first version watched this with `createEffect` at plugin level, and in a real OpenCode those
 * effects never ran: the console opened, painted once with nothing, and never heard of new output.
 * Review's panel never relied on effects (it polls on an interval), and this follows it: the client's
 * own events say when output arrived, and a fetch answers with the screen.
 */

import type { CockpitClient } from "@opencode-cockpit/client"
import type { LogLine, ScreenResult } from "@opencode-cockpit/protocol/shell"

export interface Feed {
  /** Follow this shell, or none. Attaches for its output and fetches its screen. */
  follow: (id: string | undefined, fromOffset?: number) => void
  /** Rows of scrollback to fetch with the viewport. */
  setHistory: (rows: number) => void
  /** Also read the plain log, for the log view — filtered by the daemon when `grep` is set. */
  setLog: (on: boolean, grep?: string) => void
  screen: () => ScreenResult | undefined
  log: () => LogLine[]
  dispose: () => void
}

/** Log lines to read for the log view. */
const LOG_LINES = 2000

export function createFeed(client: CockpitClient, changed: () => void): Feed {
  let current: string | undefined
  let history = 0
  let reading = false
  let grep = ""
  let screen: ScreenResult | undefined
  let log: LogLine[] = []
  let timer: ReturnType<typeof setTimeout> | undefined

  const fetch = () => {
    timer = undefined
    const id = current
    if (!id) return
    void client
      .call("shell.screen", { id, ...(history > 0 ? { history } : {}) })
      .then((next) => {
        if (current !== id) return
        screen = next
        changed()
      })
      .catch(() => {})
    if (reading)
      void client
        .call("shell.read", {
          id,
          tail: LOG_LINES,
          limit: LOG_LINES,
          ...(grep ? { grep, ignoreCase: true } : {}),
        })
        .then((page) => {
          if (current !== id) return
          log = page.lines
          changed()
        })
        .catch(() => {})
  }
  /** Output arrives in bursts; one fetch per burst, like the dialog's screen. */
  const schedule = () => {
    timer ??= setTimeout(fetch, 80)
  }

  const offOutput = client.on("shell.output", (event) => {
    if (event.id === current) schedule()
  })
  const offExit = client.on("shell.exited", (info) => {
    if (info.id === current) schedule()
  })

  return {
    follow(id, fromOffset) {
      if (id === current) return schedule()
      if (current) void client.call("shell.detach", { id: current }).catch(() => {})
      current = id
      screen = undefined
      log = []
      if (!id) return
      void client
        .call("shell.attach", { id, fromOffset: fromOffset ?? Number.MAX_SAFE_INTEGER })
        .catch(() => {})
      fetch()
    },
    setHistory(rows) {
      if (rows === history) return
      history = rows
      schedule()
    },
    setLog(on, filter = "") {
      if (on === reading && filter === grep) return
      reading = on
      grep = filter
      schedule()
    },
    screen: () => screen,
    log: () => log,
    dispose() {
      clearTimeout(timer)
      offOutput()
      offExit()
    },
  }
}
