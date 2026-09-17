import { fileURLToPath } from "node:url"
import { CockpitClient } from "@opencode-cockpit/client"
import daemonPkg from "@opencode-cockpit/daemon/package.json" with { type: "json" }
import { daemonBuildId } from "@opencode-cockpit/protocol"
import pkg from "../package.json" with { type: "json" }

/** Resolves the daemon entry shipped with this package. */
export function daemonEntry(): string {
  return fileURLToPath(import.meta.resolve("@opencode-cockpit/daemon/main"))
}

/**
 * Inside OpenCode `process.execPath` is the OpenCode binary; the client starts the daemon with
 * BUN_BE_BUN=1 so it runs on OpenCode's embedded Bun (ADR 0001). The expected build lets the
 * client replace a daemon left running from older plugin code.
 */
export function createClient(name: string): CockpitClient {
  const entry = daemonEntry()
  return new CockpitClient({
    client: { name, version: pkg.version, pid: process.pid },
    spawn: { entry, execPath: process.execPath },
    expectedBuild: daemonBuildId(entry, daemonPkg.version),
  })
}
