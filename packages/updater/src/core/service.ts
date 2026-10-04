/**
 * OpenCode 2's background service, and why updating a plugin is not enough on its own.
 *
 * OpenCode 2 runs the agent side in a long-lived server (`opencode serve --service`) that every window
 * attaches to. It loads plugins once, when it starts — so after an update the windows draw the new
 * interface while the service keeps the old agent side: measured 2026-10-03, a service started on Sep
 * 27 kept the pre-0.9 tools and skills (no `trail_add`, no `cockpit-setup`) through every reinstall,
 * until `opencode service restart`.
 *
 * What 2.0.18 says, measured in an isolated config: `opencode service status` prints the server's URL
 * when it runs and `stopped` when it does not, exit 0 either way; `restart` prints the URL. The
 * running service's pid is in `$XDG_STATE_HOME/opencode/service.json` (beside a password, never read
 * here), and `ps -o etime=` gives how long it has run.
 *
 * Node APIs only, through the caller's runner: doctor runs under `npx`, dev-install under Bun.
 */

import { join } from "node:path"

export const RESTART_COMMAND = "opencode service restart"

/** Runs a program; undefined when it could not start. */
export type Run = (command: string, args: readonly string[]) => { status: number; stdout: string } | undefined

export type ServiceState = { state: "running"; url: string } | { state: "stopped" } | { state: "unknown" }

export function parseServiceStatus(stdout: string): ServiceState {
  const text = stdout.trim()
  const url = /https?:\/\/\S+/.exec(text)?.[0]
  if (url) return { state: "running", url }
  if (/^stopped\b/im.test(text)) return { state: "stopped" }
  return { state: "unknown" }
}

export function serviceStatus(run: Run, bin = "opencode"): ServiceState {
  const result = run(bin, ["service", "status"])
  return result && result.status === 0 ? parseServiceStatus(result.stdout) : { state: "unknown" }
}

/** `ps`'s elapsed time, `[[dd-]hh:]mm:ss`, in seconds. */
export function parseElapsed(text: string): number | undefined {
  const match = /^\s*(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)\s*$/.exec(text)
  if (!match) return undefined
  const [, days = "0", hours = "0", minutes = "0", seconds = "0"] = match
  return ((Number(days) * 24 + Number(hours)) * 60 + Number(minutes)) * 60 + Number(seconds)
}

export function stateFile(env: Readonly<Record<string, string | undefined>>, home: string): string {
  return join(env.XDG_STATE_HOME || join(home, ".local", "state"), "opencode", "service.json")
}

/** The pid the service wrote down, from its state file's text. */
export function servicePid(text: string | undefined): number | undefined {
  if (!text) return undefined
  try {
    const pid = (JSON.parse(text) as { pid?: unknown }).pid
    return typeof pid === "number" && Number.isInteger(pid) && pid > 0 ? pid : undefined
  } catch {
    return undefined
  }
}

/** When the running service started, in ms since the epoch: its pid's elapsed time, back from `now`. */
export function serviceStartedAt(run: Run, pid: number | undefined, now: number): number | undefined {
  if (pid === undefined) return undefined
  const result = run("ps", ["-o", "etime=", "-p", String(pid)])
  const seconds = result?.status === 0 ? parseElapsed(result.stdout) : undefined
  return seconds === undefined ? undefined : now - seconds * 1000
}

/** The major version a binary reports, if it runs. */
export function majorOf(run: Run, bin: string): number | undefined {
  const result = run(bin, ["--version"])
  const version = result?.status === 0 ? /(\d+)\.\d+\.\d+/.exec(result.stdout)?.[1] : undefined
  return version ? Number(version) : undefined
}

/**
 * After an install: restart OpenCode 2's service if it is running, so it loads what was just
 * installed. Lines to print, saying what happened — or the exact command when it could not be done.
 */
export function restartService(run: Run, bin: string): string[] {
  const status = serviceStatus(run, bin)
  if (status.state === "stopped")
    return ["OpenCode 2's background service is not running: the next window starts it with this install."]
  if (status.state === "unknown")
    return [
      "Could not tell whether OpenCode 2's background service is running. If it is, it still has the old",
      `plugin code until it restarts: ${RESTART_COMMAND}`,
    ]
  const restarted = run(bin, ["service", "restart"])
  if (restarted?.status === 0)
    return [`Restarted OpenCode 2's background service (${status.url}): it now runs this install.`]
  return [
    "OpenCode 2's background service is running the old plugin code, and restarting it failed. Run:",
    `  ${RESTART_COMMAND}`,
  ]
}
