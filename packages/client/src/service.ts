/**
 * OpenCode 2's background service against the Cockpit installed now: one toast per window when the
 * service still runs an older one.
 *
 * OpenCode 2 runs the agent side in a long-lived server (`opencode serve --service`) that every window
 * attaches to, and it loads plugins once. After an update a new window draws the new interface while
 * the agent keeps the old tools and skills — measured on 2.0.18: a service started on Sep 27 had no
 * `trail_add` and no `cockpit-setup` through every reinstall, until `opencode service restart`.
 * Restarting it from here would cut every open window, so the window says so and the person decides.
 *
 * Both halves come from the same install, so each says which install it is: the agent side writes
 * `agents/<pid>.json` in Cockpit's home when it starts, and a window reads the record of the pid in
 * OpenCode's own `service.json`. Measured on 2.0.18 in an isolated config: the agent side runs in the
 * service's own process (the `start` line's pid is the pid in `service.json`), each window in its own.
 *
 * Which install is this package's `package.json`: its version, and when it was written — a dev install
 * carries the same version every time, and every install writes the file anew. Read once per process
 * and kept, because a service that outlives an install must go on saying what it loaded, not what is
 * on disk now.
 *
 * Never a false alarm: no service, a service that is not running, no record from it (one older than
 * this check, or not loaded yet), or a record from this very install — and nothing is said.
 */

import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { resolvePaths } from "@opencode-cockpit/protocol"
import { claimFeature } from "./feature.ts"
import type { Host } from "./host.ts"
import type { Log } from "./log.ts"

export const RESTART_COMMAND = "opencode service restart"

/** Which install a half was loaded from. */
export interface Install {
  version: string
  /** When the package's `package.json` was written, in ms: a new install, a new number. */
  installedAt: number
  /** The package's directory, so doctor can ask whether it is still what is installed. */
  dir: string
}

/** What the agent side writes when it starts. */
export interface AgentRecord extends Install {
  pid: number
  startedAt: number
}

const PACKAGE_DIR = dirname(dirname(fileURLToPath(import.meta.url)))

/** This package's install, read from disk. Undefined when it cannot be read. */
export function readInstall(dir: string = PACKAGE_DIR): Install | undefined {
  try {
    const file = join(dir, "package.json")
    const version = (JSON.parse(readFileSync(file, "utf8")) as { version?: unknown }).version
    if (typeof version !== "string") return undefined
    return { version, installedAt: Math.round(statSync(file).mtimeMs), dir }
  } catch {
    return undefined
  }
}

/** Read once and kept for the life of the process: what this process loaded, whatever is on disk later. */
const LOADED = Symbol.for("opencode-cockpit.loaded-install")
export function loadedInstall(): Install | undefined {
  const shared = globalThis as { [LOADED]?: { install: Install | undefined } }
  shared[LOADED] ??= { install: readInstall() }
  return shared[LOADED].install
}

export const agentsDir = (env: Readonly<Record<string, string | undefined>> = process.env): string =>
  join(resolvePaths(env as Record<string, string | undefined>).home, "agents")

export const recordPath = (dir: string, pid: number): string => join(dir, `${pid}.json`)

/** A record's text as a record; undefined for anything else. */
export function parseRecord(text: string | undefined): AgentRecord | undefined {
  if (!text) return undefined
  try {
    const value = JSON.parse(text) as Partial<AgentRecord>
    const number = (n: unknown) => typeof n === "number" && Number.isFinite(n)
    if (
      typeof value.version !== "string" ||
      typeof value.dir !== "string" ||
      !number(value.installedAt) ||
      !number(value.pid) ||
      !number(value.startedAt)
    )
      return undefined
    return value as AgentRecord
  } catch {
    return undefined
  }
}

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    /** Running, and someone else's: alive all the same. */
    return (error as { code?: string }).code === "EPERM"
  }
}

/**
 * The agent side says which install it loaded: once per process, whichever entry starts first. Records
 * of processes that have ended are removed on the way. OpenCode 2 only — on 1 both halves share a process.
 */
const RECORDED = Symbol.for("opencode-cockpit.agent-recorded")
export function recordAgent(log: Log, dir: string = agentsDir()): void {
  const shared = globalThis as { [RECORDED]?: boolean }
  if (shared[RECORDED]) return
  shared[RECORDED] = true
  const install = loadedInstall()
  if (!install) return
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    for (const name of readdirSync(dir)) {
      const pid = Number.parseInt(name, 10)
      if (Number.isInteger(pid) && pid !== process.pid && !alive(pid))
        rmSync(join(dir, name), { force: true })
    }
    const record: AgentRecord = {
      ...install,
      pid: process.pid,
      startedAt: Math.round(performance.timeOrigin),
    }
    writeFileSync(recordPath(dir, process.pid), JSON.stringify(record), { mode: 0o600 })
  } catch (error) {
    log.warn("service: could not record the agent side", { error })
  }
}

// ── The window ─────────────────────────────────────────────────────────────────────────────────

/** OpenCode 2's own note of its service, `$XDG_STATE_HOME/opencode/service.json`. */
export function serviceFile(env: Readonly<Record<string, string | undefined>>, home: string): string {
  return join(env.XDG_STATE_HOME || join(home, ".local", "state"), "opencode", "service.json")
}

/** The pid in `service.json`'s text. Nothing else in it is read: it holds a password too. */
export function servicePid(text: string | undefined): number | undefined {
  if (!text) return undefined
  try {
    const pid = (JSON.parse(text) as { pid?: unknown }).pid
    return typeof pid === "number" && Number.isInteger(pid) && pid > 0 ? pid : undefined
  } catch {
    return undefined
  }
}

export type Verdict =
  | { stale: false; why: "no install" | "no service" | "no record" | "same" | "agent newer" }
  | { stale: true; message: string }

/** What a window says, from what it found. Pure. */
export function verdict(input: {
  own: Install | undefined
  /** The service's pid, when it is running; undefined when there is none or it has stopped. */
  service: number | undefined
  record: AgentRecord | undefined
}): Verdict {
  const { own, service, record } = input
  if (!own) return { stale: false, why: "no install" }
  if (service === undefined) return { stale: false, why: "no service" }
  if (!record || record.pid !== service) return { stale: false, why: "no record" }
  if (record.version === own.version && record.installedAt === own.installedAt)
    return { stale: false, why: "same" }
  /** This window is the old one: it started before an install the service has already loaded. */
  if (record.installedAt > own.installedAt && record.version === own.version)
    return { stale: false, why: "agent newer" }
  if (record.version !== own.version && newer(record.version, own.version))
    return { stale: false, why: "agent newer" }
  const runs = record.version === own.version ? "the old one" : record.version
  const updated =
    record.version === own.version ? "Cockpit was updated" : `Cockpit was updated to ${own.version}`
  return {
    stale: true,
    message: `${updated} — OpenCode's background service still runs ${runs}. Run: ${RESTART_COMMAND}`,
  }
}

/** Whether `a` is a later version than `b`: `0.10.0` after `0.9.1`, a release after its prerelease. */
export function newer(a: string, b: string): boolean {
  const parse = (v: string) => {
    const [core = "", pre] = v.split("-", 2)
    return { parts: core.split(".").map((n) => Number.parseInt(n, 10) || 0), pre }
  }
  const x = parse(a)
  const y = parse(b)
  for (let i = 0; i < Math.max(x.parts.length, y.parts.length); i++) {
    const d = (x.parts[i] ?? 0) - (y.parts[i] ?? 0)
    if (d !== 0) return d > 0
  }
  if (x.pre === y.pre) return false
  if (x.pre === undefined) return true
  if (y.pre === undefined) return false
  return x.pre > y.pre
}

/** What a window reads. A seam for tests; the real one reads the disk. */
export interface ServiceIo {
  read(path: string): string | undefined
  alive(pid: number): boolean
  env: Readonly<Record<string, string | undefined>>
  home: string
}

const readText = (path: string): string | undefined => {
  try {
    return readFileSync(path, "utf8")
  } catch {
    return undefined
  }
}

export const diskIo = (): ServiceIo => ({ read: readText, alive, env: process.env, home: homedir() })

/** The verdict for this window, from the disk. */
export function look(own: Install | undefined, io: ServiceIo = diskIo()): Verdict {
  const pid = servicePid(io.read(serviceFile(io.env, io.home)))
  const service = pid !== undefined && io.alive(pid) ? pid : undefined
  const record =
    service === undefined ? undefined : parseRecord(io.read(recordPath(agentsDir(io.env), service)))
  return verdict({ own, service, record })
}

/**
 * Looked at a few times over the first minute: the first window starts the service, which loads its
 * plugins (and writes its record) a moment later. Stops at the first answer that is not "no record".
 */
export const LOOK_AT_MS = [3_000, 10_000, 30_000, 60_000] as const

/** Once per window, OpenCode 2 only: the first Cockpit entry to start looks, the rest do not. */
export function registerServiceCheck(host: Host, source: string, io: ServiceIo = diskIo()): void {
  if (host.version !== 2) return
  const claim = claimFeature(host.renderer, "service-check", source)
  if (!claim.active) return
  const own = loadedInstall()
  const timers: ReturnType<typeof setTimeout>[] = []
  let done = false
  host.lifecycle.onDispose(() => {
    done = true
    for (const timer of timers) clearTimeout(timer)
    claim.release()
  })
  for (const at of LOOK_AT_MS) {
    timers.push(
      setTimeout(() => {
        if (done) return
        const said = look(own, io)
        if (!said.stale && said.why === "no record") return
        done = true
        host.log.info("service: looked", { ...said, at })
        if (said.stale)
          host.ui.toast({ variant: "warning", title: "Cockpit", message: said.message, duration: 15_000 })
      }, at),
    )
  }
}
