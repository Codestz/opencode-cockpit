import { spawn } from "node:child_process"
import { closeSync, mkdirSync, openSync, rmSync, statSync, writeSync } from "node:fs"
import type { CockpitPaths } from "@opencode-cockpit/protocol"

export interface SpawnOptions {
  /** Path to the daemon entry script (`@opencode-cockpit/daemon/main`). */
  entry: string
  /** Runtime used to run it. Inside OpenCode this is the OpenCode binary, run with BUN_BE_BUN=1. */
  execPath?: string
  env?: Record<string, string | undefined>
}

const LOCK_STALE_MS = 15_000

/**
 * Takes an exclusive spawn lock so concurrent first calls start one daemon. Returns false when
 * another process holds a fresh lock (it is spawning; the caller should just wait and connect).
 */
export function spawnDaemon(paths: CockpitPaths, options: SpawnOptions): boolean {
  mkdirSync(paths.home, { recursive: true, mode: 0o700 })
  if (!acquireLock(paths.lockFile)) return false
  try {
    const child = spawn(options.execPath ?? process.execPath, [options.entry], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, ...options.env, BUN_BE_BUN: "1", COCKPIT_HOME: paths.home },
    })
    child.unref()
  } catch (err) {
    releaseLock(paths.lockFile)
    throw err
  }
  // The lock is released after the caller connects or times out; see releaseSpawnLock.
  return true
}

export function releaseSpawnLock(paths: CockpitPaths): void {
  releaseLock(paths.lockFile)
}

function acquireLock(file: string): boolean {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(file, "wx", 0o600)
      writeSync(fd, String(process.pid))
      closeSync(fd)
      return true
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err
      try {
        if (Date.now() - statSync(file).mtimeMs > LOCK_STALE_MS) {
          rmSync(file, { force: true })
          continue
        }
      } catch {
        continue // vanished between calls; retry
      }
      return false
    }
  }
  return false
}

function releaseLock(file: string): void {
  rmSync(file, { force: true })
}
