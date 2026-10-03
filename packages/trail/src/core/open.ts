/**
 * Which program opens a link in the browser, decided without running anything — the interface half
 * spawns it (`tui/open.ts`), asynchronously and detached, so a click never stalls a frame.
 *
 * Neither OpenCode gives a plugin an opener of its own (docs/opencode/trail-interface.md, spike 5),
 * so this is what OpenCode 2's bundled `open` does: `open` on macOS, `start` through `cmd` on
 * Windows, `xdg-open` elsewhere. On macOS `/usr/bin/open` is tried before PATH, for the reason
 * gotchas.md gives about `ps`: OpenCode can be started with a PATH that has lost the system's
 * directories, and a click that does nothing is worse than one that names what failed.
 *
 * Only `http(s)` is ever handed over.
 */

import { openable } from "./links.ts"

export interface Opener {
  command: string
  args: string[]
}

export interface OpenerWhere {
  platform: string
  /** Whether a file exists and can be run. */
  exists: (path: string) => boolean
  /** A program's full path from PATH, or nothing. */
  which: (name: string) => string | undefined
  /** `COCKPIT_OPENER`: a program to run instead, for a sandbox or a test (a stub that logs the link). */
  override?: string
}

/** The command that opens `url`, or nothing: a link that is not http(s), or no opener to be found. */
export function openerFor(url: string, where: OpenerWhere): Opener | undefined {
  if (!openable(url)) return undefined
  if (where.override) return { command: where.override, args: [url] }
  if (where.platform === "darwin") {
    const command = where.exists("/usr/bin/open") ? "/usr/bin/open" : where.which("open")
    return command ? { command, args: [url] } : undefined
  }
  if (where.platform === "win32") {
    /** `start`'s first quoted argument is a window title; an empty one keeps the link from being read as it. */
    return { command: where.which("cmd") ?? "cmd", args: ["/c", "start", '""', url.replace(/&/g, "^&")] }
  }
  const command = where.which("xdg-open")
  return command ? { command, args: [url] } : undefined
}
