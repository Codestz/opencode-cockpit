import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { silentLogger } from "../src/core/logger.ts"
import { ShellModule } from "../src/modules/shell/module.ts"
import { ProcessRegistry, processStartTime } from "../src/modules/shell/registry.ts"

const dirs: string[] = []
const tempFile = () => {
  const dir = mkdtempSync("/tmp/ck-reg-")
  dirs.push(dir)
  return join(dir, "shells.json")
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const alive = (pid: number) => {
  try {
    process.kill(-pid, 0)
    return true
  } catch {
    return false
  }
}

/** A process group that outlives its creator, like shells of a crashed daemon. */
function orphanGroup() {
  const proc = Bun.spawn(["bash", "-c", "sleep 60 & sleep 60; wait"], {
    terminal: { cols: 80, rows: 24, data() {} },
  } as Parameters<typeof Bun.spawn>[1])
  return proc.pid
}

describe("ProcessRegistry", () => {
  test("a restarted daemon kills process groups left by the previous one", async () => {
    const file = tempFile()
    const pid = orphanGroup()
    await Bun.sleep(100)
    new ProcessRegistry(file, silentLogger).add("sh_aaaaaaaa", pid, "bash")
    expect(JSON.parse(readFileSync(file, "utf8"))).toHaveLength(1)

    const module = new ShellModule({ registryFile: file })
    await module.start({ log: silentLogger, emit() {} })
    await Bun.sleep(100)
    expect(alive(pid)).toBe(false)
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual([])
    await module.stop()
  })

  test("never kills a pid that now belongs to a different process", async () => {
    const file = tempFile()
    const pid = orphanGroup()
    await Bun.sleep(100)
    writeFileSync(
      file,
      JSON.stringify([{ id: "sh_bbbbbbbb", pid, started: "Thu Jan  1 00:00:00 1970", command: "x" }]),
    )
    expect(new ProcessRegistry(file, silentLogger).reap()).toBe(0)
    expect(alive(pid)).toBe(true)
    process.kill(-pid, "SIGKILL")
  })

  test("tracks shells while running and forgets them on exit", async () => {
    const file = tempFile()
    const module = new ShellModule({ registryFile: file })
    await module.start({ log: silentLogger, emit() {} })
    const info = await module.methods.start(
      {
        command: "bash",
        args: ["-c", "sleep 0.3"],
        cwd: "/tmp",
        cols: 80,
        rows: 24,
        owner: { project: "/tmp" },
        reuse: false,
      },
      { peer: undefined as never },
    )
    expect(JSON.parse(readFileSync(file, "utf8"))[0].id).toBe(info.id)
    expect(processStartTime(info.pid as number)).toBeTruthy()
    await Bun.sleep(700)
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual([])
    await module.stop()
  })
})
