#!/usr/bin/env bun
/** cockpitd entry point. Started detached by clients (ADR 0001); safe to run by hand for debugging. */
import { join } from "node:path"
import { resolvePaths } from "@opencode-cockpit/protocol"
import { Daemon } from "./core/daemon.ts"
import type { Level } from "./core/logger.ts"
import { createModules } from "./modules/index.ts"

const env = process.env
const foreground = process.argv.includes("--foreground")

const paths = resolvePaths(env)
const daemon = new Daemon({
  paths,
  modules: createModules({ shell: { registryFile: join(paths.home, "shells.json") } }),
  idleTimeoutMs: Number(env.COCKPIT_IDLE_TIMEOUT_MS ?? 10 * 60_000),
  logLevel: (env.COCKPIT_LOG_LEVEL as Level | undefined) ?? "info",
  logToFile: !foreground,
})

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => void daemon.stop(signal))
}
process.on("uncaughtException", (err) =>
  daemon.log.error("uncaught exception", { err: String(err), stack: err.stack }),
)
process.on("unhandledRejection", (err) => daemon.log.error("unhandled rejection", { err: String(err) }))

try {
  await daemon.start()
} catch (err) {
  daemon.log.error("failed to start", { err: String(err) })
  process.exit(1)
}
await daemon.stopped
process.exit(0)
