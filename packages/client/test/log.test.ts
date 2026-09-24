import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createLog, levelFrom } from "../src/log.ts"

/**
 * The log is what someone attaches to an issue, so what it keeps is tested: the line shape a reader
 * greps for, errors with their stack, the switch that turns detail on, and a file that cannot grow
 * for ever.
 */

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const fresh = () => {
  const dir = mkdtempSync("/tmp/ck-log-")
  dirs.push(dir)
  return join(dir, "cockpit.log")
}
const lines = (file: string) =>
  readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>)

describe("the shared log", () => {
  test("one JSON line per event, scoped by half and bay, with the process it came from", () => {
    const file = fresh()
    createLog("tui", { file, level: "info" }).child("shell").info("start", { opencode: 2 })
    const [line] = lines(file)
    expect(line).toMatchObject({
      lvl: "info",
      scope: "tui:shell",
      msg: "start",
      opencode: 2,
      pid: process.pid,
    })
    expect(typeof line?.t).toBe("string")
  })

  test("an error keeps its message and stack, which JSON would drop", () => {
    const file = fresh()
    createLog("server", { file, level: "info" }).error("start failed", { error: new Error("boom") })
    const error = lines(file)[0]?.error as { message: string; stack: string }
    expect(error.message).toBe("boom")
    expect(error.stack).toContain("boom")
  })

  test("detail is written only when asked for", () => {
    const file = fresh()
    createLog("tui", { file, level: "info" }).debug("paint")
    expect(existsSync(file)).toBe(false)
    createLog("tui", { file, level: "debug" }).debug("paint")
    expect(lines(file)).toHaveLength(1)
  })

  test("a file past its size moves aside, one generation kept", () => {
    const file = fresh()
    writeFileSync(file, "x".repeat(6 * 1024 * 1024))
    createLog("tui", { file, level: "info" }).info("after")
    expect(existsSync(`${file}.1`)).toBe(true)
    expect(lines(file)).toHaveLength(1)
  })

  /** A fresh machine: the plugin's first lines come before the daemon has made the directory. */
  test("the first line makes the directory it goes in", () => {
    const file = join(fresh().replace(/cockpit\.log$/, ""), "not-yet", "cockpit.log")
    createLog("server", { file, level: "info" }).info("start")
    expect(lines(file)).toHaveLength(1)
  })

  test("a log that cannot write stays quiet rather than breaking what called it", () => {
    expect(() =>
      createLog("tui", { file: "/nonexistent/dir/cockpit.log", level: "debug" }).error("x"),
    ).not.toThrow()
  })
})

describe("the switch", () => {
  test("COCKPIT_DEBUG turns everything on; COCKPIT_LOG_LEVEL picks; info otherwise", () => {
    expect(levelFrom({})).toBe("info")
    expect(levelFrom({ COCKPIT_DEBUG: "1" })).toBe("debug")
    expect(levelFrom({ COCKPIT_DEBUG: "0" })).toBe("info")
    expect(levelFrom({ COCKPIT_LOG_LEVEL: "warn" })).toBe("warn")
    expect(levelFrom({ COCKPIT_LOG_LEVEL: "loud" })).toBe("info")
  })
})
