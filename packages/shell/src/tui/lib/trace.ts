import { appendFileSync } from "node:fs"
import { join } from "node:path"
import { resolvePaths } from "@opencode-cockpit/protocol"

/**
 * What the TUI half did, as JSON lines in `<cockpit home>/tui.log` — beside the daemon's own log, in
 * the same shape, so the two read as one story.
 *
 * The TUI has nowhere else to say anything: stderr is the terminal it is drawing on, and a toast is
 * gone before you read it. This exists for the moments a view does something only on one person's
 * machine. Synchronous and swallowed: a trace that can break the interface is worse than none.
 */
const file = (() => {
  try {
    return join(resolvePaths().home, "tui.log")
  } catch {
    return undefined
  }
})()

export function trace(msg: string, fields?: Record<string, unknown>): void {
  if (!file) return
  try {
    appendFileSync(
      file,
      `${JSON.stringify({ t: new Date().toISOString(), scope: "shell-tui", msg, ...fields })}\n`,
      {
        mode: 0o600,
      },
    )
  } catch {
    // Never let a log line take the interface down.
  }
}
