/**
 * Which program opens a link or a file in the system's own app — Trail's links, Review's images — as a
 * command and its arguments. Deciding runs nothing; the bay spawns it, detached, so a click never
 * stalls a frame.
 *
 * Neither OpenCode gives a plugin an opener of its own (docs/opencode/trail-interface.md, spike 5), so
 * this is what OpenCode 2's bundled `open` does: `open` on macOS, `start` through `cmd` on Windows,
 * `xdg-open` elsewhere.
 *
 * - **macOS tries `/usr/bin/open` before PATH**, for the reason gotchas.md gives about `ps`: OpenCode
 *   can be started with a PATH that has lost the system's directories, and a click that does nothing
 *   is worse than one that names what failed.
 * - **Programs are found on the PATH the spawn is given** (`Bun.which` with it explicitly): `Bun.spawn`
 *   resolves a bare name from the parent's PATH, not the env passed to it.
 * - **`COCKPIT_OPENER`** names a program to run instead, for a sandbox or a test (a stub that logs
 *   what it was handed). It is how a live check keeps a real browser or viewer from opening.
 */

import { accessSync, constants } from "node:fs"

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
  /** `COCKPIT_OPENER`: a program to run instead. */
  override?: string
}

/** The program each platform opens things with, by name: what to say when it is not there. */
export const openerName = (platform: string): string =>
  platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open"

/**
 * `cmd` reads `&` as "run another command" in an argument it was handed unquoted — Node quotes one
 * only when it has a space, a tab or a quote in it — so there it is escaped as `^&`. Quoted, `^` would
 * be read as itself.
 */
const forCmd = (target: string): string => (/[\s"]/.test(target) ? target : target.replace(/&/g, "^&"))

/** The command that opens `target`, a link or a path, or nothing when there is no opener here. */
export function openerFor(target: string, where: OpenerWhere): Opener | undefined {
  if (where.override) return { command: where.override, args: [target] }
  if (where.platform === "darwin") {
    const command = where.exists("/usr/bin/open") ? "/usr/bin/open" : where.which("open")
    return command ? { command, args: [target] } : undefined
  }
  if (where.platform === "win32") {
    /** `start` is `cmd`'s own; its first quoted argument is a window title, hence the empty one. */
    return { command: where.which("cmd") ?? "cmd", args: ["/c", "start", "", forCmd(target)] }
  }
  const command = where.which("xdg-open")
  return command ? { command, args: [target] } : undefined
}

/** Whether `path` exists and can be run: `exists` on this machine. */
export const isRunnable = (path: string): boolean => {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** This machine, with programs found on `env.PATH`. */
export function systemOpenerWhere(
  env: Readonly<Record<string, string | undefined>> = process.env,
  platform: string = process.platform,
): OpenerWhere {
  return {
    platform,
    exists: isRunnable,
    which: (name) => Bun.which(name, { PATH: env.PATH ?? "" }) ?? undefined,
    ...(env.COCKPIT_OPENER ? { override: env.COCKPIT_OPENER } : {}),
  }
}
