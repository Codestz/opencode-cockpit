import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { claimFeature } from "../src/feature.ts"
import type { Host } from "../src/host.ts"
import { silentLog } from "../src/log.ts"
import {
  type AgentRecord,
  agentsDir,
  type Install,
  LOOK_AT_MS,
  look,
  newer,
  parseRecord,
  RESTART_COMMAND,
  readInstall,
  recordAgent,
  recordPath,
  registerServiceCheck,
  type ServiceIo,
  serviceFile,
  servicePid,
  verdict,
} from "../src/service.ts"

/**
 * A window compares the install it loaded with the one OpenCode 2's background service loaded, and
 * says so once when the service's is older. What matters is that it never cries wolf: every case
 * where it cannot know says nothing.
 */

const own: Install = { version: "0.9.0", installedAt: 2_000, dir: "/inst/client" }
const record = (over: Partial<AgentRecord> = {}): AgentRecord => ({
  ...own,
  pid: 42,
  startedAt: 1_000,
  ...over,
})

describe("verdict", () => {
  test("the service loaded this very install: nothing to say", () => {
    expect(verdict({ own, service: 42, record: record() })).toEqual({ stale: false, why: "same" })
  })

  test("a dev install, same version, written after the service loaded its own: the toast", () => {
    const said = verdict({ own, service: 42, record: record({ installedAt: 1_000 }) })
    expect(said).toEqual({
      stale: true,
      message: `Cockpit was updated — OpenCode's background service still runs the old one. Run: ${RESTART_COMMAND}`,
    })
  })

  test("an update to a new version names both", () => {
    const said = verdict({ own, service: 42, record: record({ version: "0.8.0", installedAt: 500 }) })
    expect(said).toEqual({
      stale: true,
      message: `Cockpit was updated to 0.9.0 — OpenCode's background service still runs 0.8.0. Run: ${RESTART_COMMAND}`,
    })
  })

  test("an npm install keeps its files' dates: the version alone tells them apart", () => {
    const said = verdict({
      own,
      service: 42,
      record: record({ version: "0.8.2", installedAt: own.installedAt }),
    })
    expect(said.stale).toBe(true)
  })

  test("this window is the older one: not the service's to restart", () => {
    expect(verdict({ own, service: 42, record: record({ installedAt: 9_000 }) })).toEqual({
      stale: false,
      why: "agent newer",
    })
    expect(verdict({ own, service: 42, record: record({ version: "0.9.1" }) })).toEqual({
      stale: false,
      why: "agent newer",
    })
  })

  test("never a guess: no install, no service, no record, a record from another process", () => {
    expect(verdict({ own: undefined, service: 42, record: record() }).stale).toBe(false)
    expect(verdict({ own, service: undefined, record: record() })).toEqual({
      stale: false,
      why: "no service",
    })
    expect(verdict({ own, service: 42, record: undefined })).toEqual({ stale: false, why: "no record" })
    /** A record left by a service that has since restarted under another pid. */
    expect(verdict({ own, service: 43, record: record({ installedAt: 1 }) })).toEqual({
      stale: false,
      why: "no record",
    })
  })
})

test("newer compares versions, not strings", () => {
  expect(newer("0.10.0", "0.9.1")).toBe(true)
  expect(newer("0.9.1", "0.10.0")).toBe(false)
  expect(newer("0.9.0", "0.9.0-rc.1")).toBe(true)
  expect(newer("0.9.0-rc.2", "0.9.0-rc.1")).toBe(true)
  expect(newer("0.9.0", "0.9.0")).toBe(false)
})

test("records and service.json are read defensively", () => {
  expect(parseRecord(JSON.stringify(record()))).toEqual(record())
  expect(parseRecord("{")).toBeUndefined()
  expect(parseRecord(JSON.stringify({ ...record(), pid: "42" }))).toBeUndefined()
  expect(servicePid('{"id":"x","url":"http://127.0.0.1:1","pid":51190,"password":"p"}')).toBe(51190)
  expect(servicePid('{"pid":-1}')).toBeUndefined()
  expect(servicePid(undefined)).toBeUndefined()
  expect(serviceFile({ XDG_STATE_HOME: "/s" }, "/h")).toBe("/s/opencode/service.json")
  expect(serviceFile({}, "/h")).toBe("/h/.local/state/opencode/service.json")
})

test("readInstall reads this package: its version, and when its package.json was written", () => {
  const install = readInstall()
  const manifest = JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf8"))
  expect(install?.version).toBe(manifest.version)
  expect(install?.installedAt).toBeGreaterThan(0)
  expect(readInstall("/nowhere")).toBeUndefined()
})

// ── On disk ────────────────────────────────────────────────────────────────────────────────────

let dirs: string[] = []
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})
const temp = () => {
  const dir = mkdtempSync("/tmp/ck-svc-")
  dirs.push(dir)
  return dir
}

/** A machine with a service at `pid` whose record says `rec`. */
function machine(pid: number | undefined, rec?: AgentRecord): ServiceIo & { root: string } {
  const root = temp()
  const env = { XDG_STATE_HOME: join(root, "state"), COCKPIT_HOME: join(root, "cockpit") }
  if (pid !== undefined) {
    mkdirSync(join(root, "state", "opencode"), { recursive: true })
    writeFileSync(serviceFile(env, root), JSON.stringify({ id: "x", pid, password: "secret" }))
  }
  if (rec) {
    mkdirSync(agentsDir(env), { recursive: true })
    writeFileSync(recordPath(agentsDir(env), rec.pid), JSON.stringify(rec))
  }
  const read = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : undefined)
  return { root, env, home: root, read, alive: (each) => each === pid }
}

describe("look", () => {
  test("the service's own record, through service.json's pid", () => {
    expect(look(own, machine(42, record({ installedAt: 1 }))).stale).toBe(true)
    expect(look(own, machine(42, record()))).toEqual({ stale: false, why: "same" })
  })

  test("a service.json whose pid has ended is no service", () => {
    const io = machine(42, record({ installedAt: 1 }))
    expect(look(own, { ...io, alive: () => false })).toEqual({ stale: false, why: "no service" })
  })

  test("no service.json, or no record yet", () => {
    expect(look(own, machine(undefined))).toEqual({ stale: false, why: "no service" })
    expect(look(own, machine(42))).toEqual({ stale: false, why: "no record" })
  })
})

test("recordAgent writes this process's install once, and clears records of ended processes", () => {
  const dir = temp()
  writeFileSync(join(dir, "999999.json"), "{}")
  const flag = Symbol.for("opencode-cockpit.agent-recorded")
  const shared = globalThis as { [flag]?: boolean }
  shared[flag] = false
  recordAgent(silentLog, dir)
  const written = parseRecord(readFileSync(recordPath(dir, process.pid), "utf8"))
  expect(written).toMatchObject({ pid: process.pid, version: readInstall()?.version })
  expect(existsSync(join(dir, "999999.json"))).toBe(false)
  /** Once per process: a second entry starting does not write again. */
  rmSync(recordPath(dir, process.pid))
  recordAgent(silentLog, dir)
  expect(existsSync(recordPath(dir, process.pid))).toBe(false)
})

// ── The window ─────────────────────────────────────────────────────────────────────────────────

function fakeHost(version: 1 | 2 = 2) {
  const toasts: { message: string; variant?: string }[] = []
  const disposers: (() => void)[] = []
  const host = {
    version,
    renderer: {},
    ui: { toast: (options: { message: string; variant?: string }) => toasts.push(options) },
    lifecycle: { onDispose: (fn: () => void) => disposers.push(fn) },
    log: silentLog,
  } as unknown as Host
  return {
    host,
    toasts,
    dispose: () => {
      for (const fn of disposers) fn()
    },
  }
}

describe("registerServiceCheck", () => {
  test("one toast per window, however many Cockpit entries it loads", async () => {
    const fake = fakeHost()
    const install = readInstall() as Install
    const io = machine(42, record({ ...install, installedAt: install.installedAt - 60_000 }))
    const timers: (() => void)[] = []
    const real = globalThis.setTimeout
    globalThis.setTimeout = ((fn: () => void) => timers.push(fn)) as never
    try {
      registerServiceCheck(fake.host, "opencode-cockpit", io)
      registerServiceCheck({ ...fake.host } as Host, "@opencode-cockpit/status", io)
    } finally {
      globalThis.setTimeout = real
    }
    expect(timers).toHaveLength(LOOK_AT_MS.length)
    for (const fire of timers) fire()
    expect(fake.toasts).toHaveLength(1)
    expect(fake.toasts[0]?.message).toContain(RESTART_COMMAND)
    fake.dispose()
    expect(claimFeature(fake.host.renderer, "service-check", "again").active).toBe(true)
  })

  test("OpenCode 1 has no service: nothing is looked at", () => {
    const fake = fakeHost(1)
    let read = false
    registerServiceCheck(fake.host, "opencode-cockpit", {
      ...machine(42),
      read: () => {
        read = true
        return undefined
      },
    })
    expect(read).toBe(false)
    expect(claimFeature(fake.host.renderer, "service-check", "other").active).toBe(true)
  })
})
