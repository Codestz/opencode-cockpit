import { describe, expect, test } from "bun:test"
import { Owner, ShellInfo, StartParams } from "@opencode-cockpit/protocol/shell"
import {
  activityOf,
  exitOutcome,
  exitText,
  healthOutcome,
  healthText,
  routeNotice,
  subagentNote,
} from "../src/core/notice.ts"

/**
 * Who hears about a shell. It is shown in the conversation but was asked for by whoever called
 * shell_start — a subagent, sometimes — and waking the main agent for a subagent's shell, while the
 * subagent waiting on it never hears, is the bug these guard against.
 */

const info = (over: Partial<ShellInfo> = {}): ShellInfo => ({
  id: "sh_abcdefgh",
  title: "unit tests",
  command: "/bin/zsh",
  args: ["-c", "bun test"],
  cwd: "/p",
  owner: { project: "/p", session: "ses_root", origin: "ses_sub", instance: "inst" },
  status: "exited",
  exitCode: 1,
  run: 1,
  startedAt: 1_000,
  endedAt: 3_000,
  cols: 80,
  rows: 24,
  lines: { first: 1, last: 2 },
  bytes: 0,
  ...over,
})

const owner = (origin?: string) => ({ project: "/p", session: "ses_root", ...(origin ? { origin } : {}) })

describe("where a notice goes", () => {
  test("started in the conversation itself: the conversation, as always", () => {
    for (const outcome of ["failure", "clean"] as const)
      expect(routeNotice({ owner: owner("ses_root"), outcome, originBusy: false })).toEqual({
        kind: "deliver",
        session: "ses_root",
        steer: false,
      })
  })

  test("no origin recorded (an older plugin or daemon): the conversation, as before", () => {
    expect(routeNotice({ owner: owner(), outcome: "clean", originBusy: undefined })).toEqual({
      kind: "deliver",
      session: "ses_root",
      steer: false,
    })
  })

  test("a subagent still running: that subagent, steered into its turn", () => {
    for (const outcome of ["failure", "clean"] as const)
      expect(routeNotice({ owner: owner("ses_sub"), outcome, originBusy: true })).toEqual({
        kind: "deliver",
        session: "ses_sub",
        steer: true,
      })
  })

  test("a finished subagent's failure: the conversation, naming the subagent", () => {
    expect(routeNotice({ owner: owner("ses_sub"), outcome: "failure", originBusy: false })).toEqual({
      kind: "parent",
      session: "ses_root",
      subagent: "ses_sub",
    })
  })

  test("a finished subagent's clean result: nobody", () => {
    expect(routeNotice({ owner: owner("ses_sub"), outcome: "clean", originBusy: false }).kind).toBe("drop")
  })

  test("not knowing whether the subagent runs is read as finished", () => {
    expect(routeNotice({ owner: owner("ses_sub"), outcome: "failure", originBusy: undefined }).kind).toBe(
      "parent",
    )
    expect(routeNotice({ owner: owner("ses_sub"), outcome: "clean", originBusy: undefined }).kind).toBe(
      "drop",
    )
  })

  test("a shell the user started tells no one", () => {
    expect(routeNotice({ owner: { project: "/p" }, outcome: "failure", originBusy: true }).kind).toBe("drop")
  })
})

describe("what counts as a failure", () => {
  test("exits", () => {
    expect(exitOutcome(info({ exitCode: 0 }))).toBe("clean")
    expect(exitOutcome(info({ exitCode: 2 }))).toBe("failure")
    expect(exitOutcome(info({ status: "killed", exitCode: undefined, signal: "SIGTERM" }))).toBe("failure")
    expect(exitOutcome(info({ status: "failed", exitCode: undefined, error: "ENOENT" }))).toBe("failure")
  })

  test("health: only fail is bad news", () => {
    expect(healthOutcome("fail")).toBe("failure")
    expect(healthOutcome("ok")).toBe("clean")
    expect(healthOutcome("unknown")).toBe("clean")
  })
})

describe("the notices", () => {
  test("an exit carries status, the tail and what to do next", () => {
    const text = exitText(info(), [
      { n: 1, text: "1 failed" },
      { n: 2, text: "error: boom" },
    ])
    expect(text).toContain('<shell_exited id="sh_abcdefgh" title="unit tests">')
    expect(text).toContain("crashed with exit code 1")
    expect(text).toContain("2| error: boom")
    expect(text).toContain('shell_read id=sh_abcdefgh grep="error|fail"')
    expect(exitText(info({ exitCode: 0 }), [])).toContain("(no output)")
  })

  test("a health change", () => {
    const text = healthText(info({ watch: { preset: "tsc", status: "fail", runs: 1, since: 0 } }), {
      previous: "ok",
      current: "fail",
      summary: "Found 2 errors",
    })
    expect(text).toContain('<shell_health id="sh_abcdefgh" title="unit tests" status="fail">')
    expect(text).toContain("tsc: ok → fail")
    expect(text).toContain("Found 2 errors")
  })

  test("the parent is told who the subagent was and how to continue it, per OpenCode", () => {
    const sub = { session: "ses_sub", agent: "general", title: "Run the tests" }
    const v1 = subagentNote(sub, 1)
    expect(v1).toContain('the general subagent "Run the tests" (session ses_sub)')
    expect(v1).toContain("already finished")
    expect(v1).toContain('task tool with task_id "ses_sub"')
    const v2 = subagentNote(sub, 2)
    expect(v2).toContain('subagent tool with sessionID "ses_sub"')
    expect(v2).not.toContain("task_id")
  })

  test("a subagent whose name and title are unknown is still named by its session", () => {
    expect(subagentNote({ session: "ses_sub" }, 1)).toContain("started by a subagent (session ses_sub)")
  })
})

describe("following whether a session works", () => {
  test("OpenCode 2 events", () => {
    const v2 = (type: string, data: object) => activityOf({ type, data })
    expect(v2("session.execution.started", { sessionID: "s" })).toEqual({ session: "s", busy: true })
    for (const end of ["succeeded", "failed", "interrupted"])
      expect(v2(`session.execution.${end}`, { sessionID: "s" })).toEqual({ session: "s", busy: false })
    expect(v2("session.status", { sessionID: "s", status: { type: "idle" } })).toEqual({
      session: "s",
      busy: false,
    })
  })

  test("OpenCode 1 events", () => {
    const v1 = (type: string, properties: object) => activityOf({ type, properties })
    expect(v1("session.status", { sessionID: "s", status: { type: "busy" } })).toEqual({
      session: "s",
      busy: true,
    })
    expect(v1("session.status", { sessionID: "s", status: { type: "retry" } })?.busy).toBe(true)
    expect(v1("session.idle", { sessionID: "s" })).toEqual({ session: "s", busy: false })
  })

  test("anything else says nothing", () => {
    expect(activityOf({ type: "session.deleted", data: { sessionID: "s" } })).toBeUndefined()
    expect(activityOf({ type: "session.idle" })).toBeUndefined()
    expect(activityOf(undefined)).toBeUndefined()
    expect(activityOf("session.idle")).toBeUndefined()
  })
})

describe("the origin in the protocol", () => {
  test("is optional, so an owner from an older plugin still parses", () => {
    expect(Owner.parse({ project: "/p", session: "ses_root" })).toEqual({
      project: "/p",
      session: "ses_root",
    })
    const old = info()
    const { origin: _, ...ownerWithout } = old.owner
    expect(ShellInfo.parse({ ...old, owner: ownerWithout }).owner.origin).toBeUndefined()
  })

  test("is kept when sent", () => {
    const parsed = StartParams.parse({
      command: "bun",
      cwd: "/p",
      owner: { project: "/p", session: "ses_root", origin: "ses_sub" },
    })
    expect(parsed.owner.origin).toBe("ses_sub")
  })

  test("must be a session id, not empty", () => {
    expect(Owner.safeParse({ project: "/p", origin: "" }).success).toBe(false)
  })
})
