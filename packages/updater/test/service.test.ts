import { describe, expect, test } from "bun:test"
import {
  parseElapsed,
  parseServiceStatus,
  type Run,
  restartService,
  servicePid,
  serviceStartedAt,
} from "../src/core/service.ts"

/**
 * OpenCode 2's background service, through a runner made of a script — never the real one: a test
 * that restarted it would cut off whoever is using OpenCode on this machine.
 */

/** Answers each `<command> <args>` from a table, and remembers what was run. */
function runner(answers: Record<string, { status: number; stdout: string } | undefined>) {
  const ran: string[] = []
  const run: Run = (command, args) => {
    const line = [command, ...args].join(" ")
    ran.push(line)
    return answers[line]
  }
  return { run, ran }
}

describe("what `opencode service status` says (2.0.18)", () => {
  test("a URL is running, `stopped` is stopped, anything else is unknown", () => {
    expect(parseServiceStatus("http://127.0.0.1:49374\n")).toEqual({
      state: "running",
      url: "http://127.0.0.1:49374",
    })
    expect(parseServiceStatus("stopped\n")).toEqual({ state: "stopped" })
    expect(parseServiceStatus("")).toEqual({ state: "unknown" })
  })

  test("ps's elapsed time, in every shape it prints", () => {
    expect(parseElapsed("  05:07\n")).toBe(307)
    expect(parseElapsed("01:02:03")).toBe(3723)
    expect(parseElapsed("22-00:13:28")).toBe(22 * 86400 + 13 * 60 + 28)
    expect(parseElapsed("")).toBeUndefined()
  })

  test("the pid from the state file, and when that process started", () => {
    expect(servicePid('{"id":"x","pid":3310,"password":"p"}')).toBe(3310)
    expect(servicePid("nope")).toBeUndefined()
    const { run } = runner({ "ps -o etime= -p 3310": { status: 0, stdout: "01:00\n" } })
    expect(serviceStartedAt(run, 3310, 1_000_000)).toBe(940_000)
    expect(serviceStartedAt(run, undefined, 1_000_000)).toBeUndefined()
  })
})

describe("after an install", () => {
  const BIN = "/home/me/.opencode/bin/opencode"

  test("running: restarted, and says so", () => {
    const { run, ran } = runner({
      [`${BIN} service status`]: { status: 0, stdout: "http://127.0.0.1:49374\n" },
      [`${BIN} service restart`]: { status: 0, stdout: "http://127.0.0.1:49374\n" },
    })
    expect(restartService(run, BIN)).toEqual([
      "Restarted OpenCode 2's background service (http://127.0.0.1:49374): it now runs this install.",
    ])
    expect(ran).toEqual([`${BIN} service status`, `${BIN} service restart`])
  })

  test("stopped: nothing restarted", () => {
    const { run, ran } = runner({ [`${BIN} service status`]: { status: 0, stdout: "stopped\n" } })
    expect(restartService(run, BIN)[0]).toContain("not running")
    expect(ran).toEqual([`${BIN} service status`])
  })

  test("a restart that fails, or a status it cannot read, prints the exact command", () => {
    const failed = runner({
      [`${BIN} service status`]: { status: 0, stdout: "http://127.0.0.1:49374\n" },
      [`${BIN} service restart`]: { status: 1, stdout: "" },
    })
    expect(restartService(failed.run, BIN).at(-1)).toBe("  opencode service restart")
    const unknown = runner({})
    expect(restartService(unknown.run, BIN).join(" ")).toContain("opencode service restart")
    expect(unknown.ran).toEqual([`${BIN} service status`])
  })
})
