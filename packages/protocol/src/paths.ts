import { homedir } from "node:os"
import { join } from "node:path"

export interface CockpitPaths {
  home: string
  socket: string
  pidFile: string
  lockFile: string
  logFile: string
}

/**
 * Filesystem layout shared by daemon and clients. Pure: creates nothing.
 * Kept short because unix socket paths are limited to 104 bytes on macOS.
 */
export function resolvePaths(env: Record<string, string | undefined> = process.env): CockpitPaths {
  const home = env.COCKPIT_HOME ?? join(env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "opencode-cockpit")
  return {
    home,
    socket: join(home, "cockpitd.sock"),
    pidFile: join(home, "cockpitd.pid"),
    lockFile: join(home, "spawn.lock"),
    logFile: join(home, "cockpitd.log"),
  }
}
