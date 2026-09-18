import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, rmSync } from "node:fs"
import { ErrorCode, RpcError } from "@opencode-cockpit/protocol"
import { CockpitClient, compareBuilds } from "../src/index.ts"
import { bash, groupAlive, owner, startDaemon, tempHome } from "./helpers.ts"

let env: Awaited<ReturnType<typeof startDaemon>>
beforeEach(async () => {
  env = await startDaemon()
})
afterEach(async () => {
  await env.dispose()
})

describe("shell (M1 acceptance)", () => {
  test("AC1: carriage-return redraws collapse in the log", async () => {
    const c = env.client()
    const info = await c.call("shell.start", bash(`printf "\\r1\\r2\\r3\\n"`))
    await c.call("shell.wait", { id: info.id, until: { exit: true }, timeoutMs: 5000 })
    const page = await c.call("shell.read", { id: info.id, after: 0 })
    expect(page.lines.map((l) => l.text)).toEqual(["3"])
    expect(page.status).toBe("exited")
  })

  test("AC2: stop kills the whole process group, grandchildren included", async () => {
    const c = env.client()
    const info = await c.call("shell.start", bash("sleep 60 & sleep 60 & echo spawned; wait"))
    await c.call("shell.wait", { id: info.id, until: { pattern: "spawned" }, timeoutMs: 5000 })
    const pid = info.pid as number
    expect(groupAlive(pid)).toBe(true)
    const stopped = await c.call("shell.stop", { id: info.id, graceMs: 1000 })
    expect(stopped.status).toBe("killed")
    await Bun.sleep(100)
    expect(groupAlive(pid)).toBe(false)
  })

  test("AC3: wait resolves on pattern, and on timeout without a match", async () => {
    const c = env.client()
    const info = await c.call("shell.start", bash("sleep 0.3; echo 'server ready on 3000'; sleep 30"))
    const t0 = Date.now()
    const hit = await c.call("shell.wait", {
      id: info.id,
      until: { pattern: "ready on (\\d+)" },
      timeoutMs: 5000,
    })
    expect(hit.reason).toBe("pattern")
    expect(hit.match?.text).toBe("server ready on 3000")
    expect(Date.now() - t0).toBeLessThan(1500)

    const t1 = Date.now()
    const miss = await c.call("shell.wait", { id: info.id, until: { pattern: "never" }, timeoutMs: 300 })
    expect(miss.reason).toBe("timeout")
    expect(Date.now() - t1).toBeGreaterThanOrEqual(290)
  })

  test("AC3b: wait matches output that happened before the wait (already ready)", async () => {
    const c = env.client()
    const info = await c.call("shell.start", bash("echo ready; sleep 30"))
    await Bun.sleep(300)
    const hit = await c.call("shell.wait", { id: info.id, until: { pattern: "ready" }, timeoutMs: 1000 })
    expect(hit.reason).toBe("pattern")
  })

  test("AC3d: wait matches a prompt that was already on screen before the wait started", async () => {
    const c = env.client()
    const info = await c.call("shell.start", bash("printf 'Password: '; read secret"))
    await Bun.sleep(400) // prompt printed, then silence: nothing new will arrive during the wait
    const hit = await c.call("shell.wait", { id: info.id, until: { pattern: "Password:" }, timeoutMs: 1500 })
    expect(hit.reason).toBe("pattern")
    expect(hit.match?.text).toBe("Password:")
  })

  test("AC3c: wait matches a prompt that never ends in a newline", async () => {
    const c = env.client()
    const info = await c.call("shell.start", bash("printf 'Continue? [y/N] '; read answer; echo got=$answer"))
    const prompt = await c.call("shell.wait", {
      id: info.id,
      until: { pattern: "\\[y/N\\]" },
      timeoutMs: 3000,
    })
    expect(prompt.reason).toBe("pattern")
    await c.call("shell.write", { id: info.id, data: "y\r" })
    const done = await c.call("shell.wait", { id: info.id, until: { pattern: "got=y" }, timeoutMs: 3000 })
    expect(done.reason).toBe("pattern")
  })

  test("AC4: wait resolves when a port starts accepting connections", async () => {
    const c = env.client()
    const port = 20_000 + Math.floor(Math.random() * 20_000)
    const script = `sleep 0.4; exec bun -e 'Bun.serve({ port: ${port}, fetch: () => new Response("ok") }); await Bun.sleep(30000)'`
    const info = await c.call("shell.start", bash(script, { env: { PATH: process.env.PATH ?? "" } }))
    const res = await c.call("shell.wait", { id: info.id, until: { port }, timeoutMs: 8000 })
    expect(res.reason).toBe("port")
  })

  test("wait idle and exit reasons", async () => {
    const c = env.client()
    const idle = await c.call("shell.start", bash("echo hi; sleep 30"))
    expect(
      (await c.call("shell.wait", { id: idle.id, until: { idleMs: 200 }, timeoutMs: 3000 })).reason,
    ).toBe("idle")
    const quick = await c.call("shell.start", bash("sleep 0.2; exit 3"))
    const exit = await c.call("shell.wait", { id: quick.id, until: { pattern: "nope" }, timeoutMs: 3000 })
    expect(exit.reason).toBe("exit")
    expect(exit.info.exitCode).toBe(3)
    expect(exit.info.status).toBe("exited")
  })

  test("AC5: cursors return only newer lines and survive eviction", async () => {
    const c = env.client()
    const info = await c.call("shell.start", bash("for i in $(seq 1 50); do echo line $i; done"))
    await c.call("shell.wait", { id: info.id, until: { exit: true }, timeoutMs: 5000 })
    const tail = await c.call("shell.read", { id: info.id, tail: 5 })
    expect(tail.lines.map((l) => l.text)).toEqual(["line 46", "line 47", "line 48", "line 49", "line 50"])
    const after = await c.call("shell.read", { id: info.id, after: 48 })
    expect(after.lines.map((l) => l.n)).toEqual([49, 50])
    const grep = await c.call("shell.read", { id: info.id, after: 0, grep: "^line 1\\d$" })
    expect(grep.lines).toHaveLength(10)
  })

  test("AC6: every subscribed client receives shell.exited", async () => {
    const a = env.client("a")
    const b = env.client("b")
    const got: string[] = []
    a.on("shell.exited", (info) => got.push(`a:${info.id}`))
    b.on("shell.exited", (info) => got.push(`b:${info.id}`))
    await a.connect()
    await b.connect()
    await Bun.sleep(50)
    const info = await a.call("shell.start", bash("exit 0"))
    await a.call("shell.wait", { id: info.id, until: { exit: true }, timeoutMs: 3000 })
    await Bun.sleep(50)
    expect(got.sort()).toEqual([`a:${info.id}`, `b:${info.id}`])
  })

  test("AC9: invalid params and unknown methods", async () => {
    const c = env.client()
    const bad = await c.call("shell.start", { command: "", cwd: "/tmp", owner } as never).catch((e) => e)
    expect(bad).toBeInstanceOf(RpcError)
    expect(bad.code).toBe(ErrorCode.InvalidParams)
    expect(bad.message).toContain("command")
    const unknown = await c.call("shell.nope" as never).catch((e) => e)
    expect(unknown.code).toBe(ErrorCode.MethodNotFound)
    const missing = await c.call("shell.get", { id: "sh_aaaaaaaa" }).catch((e) => e)
    expect(missing.code).toBe(ErrorCode.NotFound)
  })

  test("interactive write, screen view, resize", async () => {
    const c = env.client()
    const info = await c.call(
      "shell.start",
      bash("printf '\\e[2J\\e[Htop line\\n'; cat", { cols: 40, rows: 10 }),
    )
    // Type only once the program is running: the terminal echoes input immediately, so typing
    // earlier lets the wait below match the echo before the program has drawn anything.
    await c.call("shell.wait", { id: info.id, until: { pattern: "top line" }, timeoutMs: 5000 })
    await c.call("shell.write", { id: info.id, data: "hello pty\r" })
    await c.call("shell.wait", { id: info.id, until: { pattern: "^hello pty$" }, timeoutMs: 3000 })
    const screen = await c.call("shell.screen", { id: info.id })
    expect(screen.text).toContain("top line")
    expect(screen.cols).toBe(40)
    await c.call("shell.resize", { id: info.id, cols: 60, rows: 12 })
    expect((await c.call("shell.get", { id: info.id })).cols).toBe(60)
    await c.call("shell.write", { id: info.id, data: "\x03" })
    const res = await c.call("shell.wait", { id: info.id, until: { exit: true }, timeoutMs: 3000 })
    expect(res.info.status).toBe("killed")
  })

  test("restart keeps the id, bumps run, and scopes wait to the new run", async () => {
    const c = env.client()
    const info = await c.call("shell.start", bash("echo run-marker; sleep 30"))
    await c.call("shell.wait", { id: info.id, until: { pattern: "run-marker" }, timeoutMs: 3000 })
    const restarted = await c.call("shell.restart", { id: info.id })
    expect(restarted.id).toBe(info.id)
    expect(restarted.run).toBe(2)
    expect(restarted.status).toBe("running")
    const again = await c.call("shell.wait", {
      id: info.id,
      until: { pattern: "run-marker" },
      timeoutMs: 3000,
    })
    expect(again.match?.n).toBeGreaterThan(1)
    await c.call("shell.remove", { id: info.id })
    expect((await c.call("shell.list")).find((s) => s.id === info.id)).toBeUndefined()
  })

  test("spawn failure is reported as a failed shell", async () => {
    const c = env.client()
    const info = await c.call("shell.start", { command: "definitely-not-a-command-xyz", cwd: "/tmp", owner })
    expect(info.status).toBe("failed")
    expect(info.error).toBeTruthy()
  })

  test("attach streams raw output with replay", async () => {
    const c = env.client()
    const info = await c.call("shell.start", bash("echo before; sleep 0.3; echo after; sleep 30"))
    await c.call("shell.wait", { id: info.id, until: { pattern: "before" }, timeoutMs: 3000 })
    let streamed = ""
    c.on("shell.output", (e) => {
      if (e.id === info.id) streamed += Buffer.from(e.data, "base64").toString()
    })
    const attached = await c.call("shell.attach", { id: info.id })
    expect(Buffer.from(attached.replay, "base64").toString()).toContain("before")
    await c.call("shell.wait", { id: info.id, until: { pattern: "after" }, timeoutMs: 3000 })
    await Bun.sleep(60)
    expect(streamed).toContain("after")
    expect(streamed).not.toContain("before")
  })

  test("list filters by owner", async () => {
    const c = env.client()
    await c.call("shell.start", bash("sleep 30"))
    await c.call("shell.start", bash("sleep 30", { owner: { project: "/other" } }))
    expect(await c.call("shell.list", { owner: { project: "/tmp/project" } })).toHaveLength(1)
    expect(await c.call("shell.list")).toHaveLength(2)
  })
})

describe("daemon lifecycle", () => {
  test("AC7: concurrent first calls spawn exactly one daemon", async () => {
    const paths = tempHome()
    const entry = new URL("../../daemon/src/main.ts", import.meta.url).pathname
    const make = () =>
      new CockpitClient({
        client: { name: "spawn-test", version: "0" },
        paths,
        spawn: { entry, env: { COCKPIT_IDLE_TIMEOUT_MS: "0" } },
      })
    const clients = [make(), make(), make()]
    try {
      const hellos = await Promise.all(clients.map((c) => c.connect()))
      expect(new Set(hellos.map((h) => h.pid)).size).toBe(1)
      expect(hellos[0]?.modules).toContain("shell")
      const pid = hellos[0]?.pid as number
      const shutdown = await clients[0]?.call("daemon.shutdown")
      expect(shutdown?.accepted).toBe(true)
      for (let i = 0; i < 40 && existsSync(paths.socket); i++) await Bun.sleep(50)
      expect(existsSync(paths.socket)).toBe(false)
      expect(() => process.kill(pid, 0)).toThrow()
    } finally {
      for (const c of clients) c.close()
      rmSync(paths.home, { recursive: true, force: true })
    }
  })

  test("AC8: daemon exits after idle timeout with no clients and no running shells", async () => {
    const local = await startDaemon(tempHome(), 200)
    const c = local.client()
    const info = await c.call("shell.start", bash("sleep 0.5"))
    c.close()
    expect(info.status).toBe("running")
    await Bun.sleep(400)
    expect(existsSync(local.paths.socket)).toBe(true) // shell still running → busy
    await Promise.race([local.daemon.stopped, Bun.sleep(8000)])
    expect(existsSync(local.paths.socket)).toBe(false)
    rmSync(local.paths.home, { recursive: true, force: true })
  })

  test("client reconnects and restores subscriptions after daemon restart", async () => {
    const paths = tempHome()
    const first = await startDaemon(paths)
    const c = new CockpitClient({ client: { name: "reconnect", version: "0" }, paths })
    const seen: string[] = []
    c.on("shell.started", (i) => seen.push(i.id))
    await c.connect()
    const lost = new Promise<void>((resolve) => c.onState((s) => s === "disconnected" && resolve()))
    await first.daemon.stop()
    await lost
    const second = await startDaemon(paths)
    const info = await c.call("shell.start", bash("sleep 1"))
    await Bun.sleep(100)
    expect(seen).toContain(info.id)
    c.close()
    await second.dispose()
  })

  test("calls before hello are rejected", async () => {
    const res = await new Promise<string>((resolve) => {
      Bun.connect({
        unix: env.paths.socket,
        socket: {
          open(s) {
            s.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "shell.list", params: {} })}\n`)
          },
          data(s, d) {
            resolve(d.toString())
            s.end()
          },
        },
      })
    })
    expect(JSON.parse(res).error.code).toBe(ErrorCode.InvalidRequest)
  })
})

describe("reuse, clear, summary", () => {
  test("start with reuse restarts the finished shell from the same session", async () => {
    const c = env.client()
    const params = bash("echo attempt; exit 1", { reuse: true })
    const first = await c.call("shell.start", params)
    await c.call("shell.wait", { id: first.id, until: { exit: true }, timeoutMs: 3000 })
    const second = await c.call("shell.start", params)
    expect(second.id).toBe(first.id)
    expect(second.run).toBe(2)
    await c.call("shell.wait", { id: second.id, until: { exit: true }, timeoutMs: 3000 })

    const otherSession = await c.call("shell.start", { ...params, owner: { ...owner, session: "ses_other" } })
    expect(otherSession.id).not.toBe(first.id)
    const noReuse = await c.call("shell.start", { ...params, reuse: false })
    expect(noReuse.id).not.toBe(first.id)
  })

  test("reuse never hijacks a running shell", async () => {
    const c = env.client()
    const params = bash("sleep 30", { reuse: true })
    const a = await c.call("shell.start", params)
    const b = await c.call("shell.start", params)
    expect(b.id).not.toBe(a.id)
  })

  test("summary picks the last error-looking line of the run", async () => {
    const c = env.client()
    const info = await c.call(
      "shell.start",
      bash("echo ok 1; echo 'Error: boom happened'; echo cleanup done; exit 2"),
    )
    const done = await c.call("shell.wait", { id: info.id, until: { exit: true }, timeoutMs: 3000 })
    await Bun.sleep(20)
    expect((await c.call("shell.get", { id: done.info.id })).summary).toBe("Error: boom happened")
    const ok = await c.call("shell.start", bash("echo all good"))
    await c.call("shell.wait", { id: ok.id, until: { exit: true }, timeoutMs: 3000 })
    await Bun.sleep(20)
    expect((await c.call("shell.get", { id: ok.id })).summary).toBe("all good")
  })

  test("clear removes finished shells only, scoped by owner", async () => {
    const c = env.client()
    const running = await c.call("shell.start", bash("sleep 30"))
    const done = await c.call("shell.start", bash("exit 0"))
    const elsewhere = await c.call("shell.start", bash("exit 0", { owner: { project: "/elsewhere" } }))
    await c.call("shell.wait", { id: done.id, until: { exit: true }, timeoutMs: 3000 })
    await c.call("shell.wait", { id: elsewhere.id, until: { exit: true }, timeoutMs: 3000 })
    const { removed } = await c.call("shell.clear", { owner: { project: owner.project } })
    expect(removed).toEqual([done.id])
    const ids = (await c.call("shell.list")).map((s) => s.id)
    expect(ids).toContain(running.id)
    expect(ids).toContain(elsewhere.id)
  })
})

describe("compareBuilds", () => {
  test("orders by semver, treats same-version different-hash as newer, and never goes backwards", () => {
    expect(compareBuilds("0.2.0+aaaaaaaaaaaa", "0.1.1+bbbbbbbbbbbb")).toBe(1)
    expect(compareBuilds("0.1.1+aaaaaaaaaaaa", "0.2.0+bbbbbbbbbbbb")).toBe(-1)
    expect(compareBuilds("0.10.0+a", "0.9.9+a")).toBe(1)
    expect(compareBuilds("1.0.0+a", "1.0.0-beta.1+a")).toBe(1)
    expect(compareBuilds("0.2.0+aaaaaaaaaaaa", "0.2.0+bbbbbbbbbbbb")).toBe(1)
    expect(compareBuilds("0.2.0+aaaaaaaaaaaa", "0.2.0+aaaaaaaaaaaa")).toBe(0)
    expect(compareBuilds("0.2.0+aaaaaaaaaaaa", undefined)).toBe(1)
  })
})

describe("daemon build mismatch", () => {
  const entry = new URL("../../daemon/src/main.ts", import.meta.url).pathname

  const spawnClient = (paths: ReturnType<typeof tempHome>, expectedBuild?: string) =>
    new CockpitClient({
      client: { name: "build-test", version: "0" },
      paths,
      spawn: { entry, env: { COCKPIT_IDLE_TIMEOUT_MS: "0" } },
      expectedBuild,
    })

  test("an idle daemon running other code is replaced; a busy one is kept and reported", async () => {
    const paths = tempHome()
    const first = spawnClient(paths)
    const original = await first.connect()
    expect(original.build).toMatch(/^\d+\.\d+\.\d+\+[0-9a-f]{12}$/)

    // Older client: never downgrades the daemon and has nothing to report.
    const olderClient = spawnClient(paths, "0.0.1+aaaaaaaaaaaa")
    const untouched = await olderClient.connect()
    expect(untouched.pid).toBe(original.pid)
    expect(olderClient.outdated).toBeUndefined()
    olderClient.close()

    // Busy: a running shell protects the daemon.
    const shell = await first.call("shell.start", bash("sleep 30"))
    const busyClient = spawnClient(paths, "99.0.0+ffffffffffff")
    const reported: unknown[] = []
    busyClient.onOutdated((info) => reported.push(info))
    const kept = await busyClient.connect()
    expect(kept.pid).toBe(original.pid)
    expect(busyClient.outdated?.expected).toBe("99.0.0+ffffffffffff")
    expect(reported).toHaveLength(1)
    busyClient.close()

    // Idle: the mismatching client replaces it.
    await first.call("shell.stop", { id: shell.id, graceMs: 500 })
    first.close()
    const idleClient = spawnClient(paths, "99.0.0+eeeeeeeeeeee")
    const replaced = await idleClient.connect()
    expect(replaced.pid).not.toBe(original.pid)
    // Still differs after one replacement (fake expected id): reported, not looped.
    expect(idleClient.outdated).toBeDefined()

    // restartDaemon refuses while busy unless forced.
    await idleClient.call("shell.start", bash("sleep 30"))
    expect(await idleClient.restartDaemon()).toBe(false)
    expect(await idleClient.restartDaemon({ force: true })).toBe(true)
    expect(idleClient.daemon?.pid).not.toBe(replaced.pid)

    await idleClient.call("daemon.shutdown", { force: true })
    idleClient.close()
    rmSync(paths.home, { recursive: true, force: true })
  }, 30_000)
})

describe("watchers", () => {
  /** A fake `tsc --watch`: prints a clean run, then a broken one, then waits. */
  const tscLike = (extra = "") =>
    bash(
      `echo 'Starting compilation in watch mode...'; sleep 0.2; echo 'Found 0 errors. Watching for file changes.'; sleep 0.4; echo "src/auth.ts(42,3): error TS2339: Property 'id' does not exist."; echo 'Found 1 error. Watching for file changes.'; sleep 30`,
      extra ? { title: extra } : {},
    )

  test("reports only status changes, and picks a preset from the command", async () => {
    const c = env.client()
    const changes: string[] = []
    c.on("shell.watch", (e) => changes.push(`${e.previous}→${e.current}`))
    await c.connect()

    const info = await c.call("shell.start", tscLike())
    // The command is a bash script, so name the preset instead of relying on auto-detection.
    const watched = await c.call("shell.watch", { id: info.id, preset: "tsc" })
    expect(watched.watch).toMatchObject({ preset: "tsc", status: "pending" })

    await c.call("shell.wait", { id: info.id, until: { pattern: "Found 1 error" }, timeoutMs: 5000 })
    await Bun.sleep(150)
    expect(changes).toEqual(["pending→ok", "ok→fail"])

    const current = await c.call("shell.get", { id: info.id })
    expect(current.watch).toMatchObject({ status: "fail", runs: 2 })
    expect(current.watch?.summary).toContain("TS2339")

    await c.call("shell.unwatch", { id: info.id })
    expect((await c.call("shell.get", { id: info.id })).watch).toBeUndefined()
    await c.call("shell.stop", { id: info.id, graceMs: 500 })
  })

  test("auto-detects from a real command line and exposes the preset table", async () => {
    const c = env.client()
    const info = await c.call("shell.start", {
      command: "/bin/bash",
      args: ["--noprofile", "--norc", "-c", "echo 'Found 0 errors.'; sleep 5"],
      cwd: "/tmp",
      owner,
    })
    // auto uses the full command line, which contains "tsc" only if the user ran tsc.
    const auto = await c.call("shell.start", bash("tsc --watch --noEmit; sleep 5"))
    const watched = await c.call("shell.watch", { id: auto.id })
    expect(watched.watch?.preset).toBe("tsc")

    const unmatched = await c.call("shell.watch", { id: info.id }).catch((e) => e)
    expect(unmatched.message).toContain("no watch preset matches")

    const presets = await c.call("shell.presets")
    expect(presets.length).toBeGreaterThan(25)
    expect(presets.map((p) => p.name)).toContain("vitest")

    for (const id of [info.id, auto.id]) await c.call("shell.stop", { id, graceMs: 500 })
  })

  test("a custom rule works without any preset, and silence can end a run", async () => {
    const c = env.client()
    const changes: string[] = []
    c.on("shell.watch", (e) => changes.push(`${e.previous}→${e.current}`))
    await c.connect()
    const info = await c.call("shell.start", bash("echo 'DEPLOY FAILED: bad config'; sleep 30"))
    await c.call("shell.watch", { id: info.id, rule: { fail: "FAILED", ok: "SUCCEEDED", idleSeconds: 1 } })
    await Bun.sleep(2500)
    expect(changes).toContain("pending→fail")
    await c.call("shell.stop", { id: info.id, graceMs: 500 })
  })

  test("a watched process that dies reports a failure", async () => {
    const c = env.client()
    const changes: { current: string; summary?: string }[] = []
    c.on("shell.watch", (e) => changes.push({ current: e.current, summary: e.summary }))
    await c.connect()
    const info = await c.call("shell.start", bash("echo 'ready in 300 ms'; sleep 0.3; exit 7"))
    await c.call("shell.watch", { id: info.id, preset: "vite" })
    await c.call("shell.wait", { id: info.id, until: { exit: true }, timeoutMs: 5000 })
    await Bun.sleep(150)
    expect(changes.at(-1)).toMatchObject({ current: "fail" })
    expect(changes.at(-1)?.summary).toContain("exit code 7")
  })
})
