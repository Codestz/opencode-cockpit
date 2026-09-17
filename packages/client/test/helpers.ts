import { mkdtempSync, rmSync } from "node:fs"
import { createModules, Daemon } from "@opencode-cockpit/daemon"
import { type CockpitPaths, resolvePaths } from "@opencode-cockpit/protocol"
import { CockpitClient } from "../src/index.ts"

/** Short temp dir: unix socket paths are capped at 104 bytes on macOS. */
export function tempHome(): CockpitPaths {
  return resolvePaths({ COCKPIT_HOME: mkdtempSync("/tmp/ck-") })
}

export async function startDaemon(paths = tempHome(), idleTimeoutMs = 0) {
  const daemon = new Daemon({
    paths,
    modules: createModules(),
    idleTimeoutMs,
    logToFile: false,
    logLevel: "error",
  })
  await daemon.start()
  const clients: CockpitClient[] = []
  const client = (name = "test") => {
    const c = new CockpitClient({ client: { name, version: "0.0.0" }, paths })
    clients.push(c)
    return c
  }
  const dispose = async () => {
    for (const c of clients) c.close()
    await daemon.stop()
    rmSync(paths.home, { recursive: true, force: true })
  }
  return { daemon, paths, client, dispose }
}

export const owner = { project: "/tmp/project", session: "ses_test" }

export const bash = (script: string, extra: Record<string, unknown> = {}) => ({
  command: "bash",
  args: ["--noprofile", "--norc", "-c", script],
  cwd: "/tmp",
  owner,
  ...extra,
})

export function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0)
    return true
  } catch {
    return false
  }
}
