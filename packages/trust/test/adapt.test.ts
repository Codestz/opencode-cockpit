/**
 * The two translators against the measured shapes. The fixtures are built from the tables in
 * docs/opencode/permissions.md (1.18.32 and 2.0.18) and the session and tool events Subagents
 * recorded on real runs — written out, not captured, because the permission events were measured by
 * a throwaway probe that is not in the repo.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { commandOf } from "../src/core/adapt/seen.ts"
import { fromV1Event, fromV1Pending } from "../src/core/adapt/v1.ts"
import { fromV2Event, fromV2Pending } from "../src/core/adapt/v2.ts"

const lines = (name: string): unknown[] =>
  readFileSync(join(import.meta.dir, "fixtures", name), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))

describe("OpenCode 1", () => {
  const seen = lines("v1.jsonl").flatMap(fromV1Event)

  test("every event Trust uses, and nothing else", () => {
    expect(seen.map((s) => s.type)).toEqual([
      "agent",
      "call",
      "asked",
      "replied",
      "agent",
      "asked",
      "replied",
    ])
  })

  test("a request, with the call that asked it", () => {
    expect(seen[2]).toEqual({
      type: "asked",
      request: {
        id: "per_1",
        sessionID: "ses_main",
        permission: "bash",
        patterns: ["docker compose -p cockpit up -d"],
        always: ["docker compose -p *"],
        call: "call_bash_1",
        messageID: "msg_asst",
      },
    })
  })

  test("the call's arguments carry the cd the patterns lost", () => {
    const call = seen[1]
    expect(call?.type).toBe("call")
    if (call?.type !== "call") return
    expect(commandOf(call.input)).toEqual({ line: "cd packages/web && docker compose -p cockpit up -d" })
  })

  test("replies, and the agent a subagent's session runs as", () => {
    expect(seen[3]).toEqual({ type: "replied", sessionID: "ses_main", requestID: "per_1", reply: "once" })
    expect(seen[4]).toEqual({ type: "agent", sessionID: "ses_child", agent: "explore" })
    expect(seen[6]).toMatchObject({ reply: "reject" })
  })

  test("the pending list has the event's shape", () => {
    const request = (lines("v1.jsonl")[3] as { properties: unknown }).properties
    expect(fromV1Pending([request])).toEqual([seen[2] as never])
    expect(fromV1Pending(undefined)).toEqual([])
  })

  test("half a request is no request", () => {
    expect(fromV1Event({ type: "permission.asked", properties: { id: "x" } })).toEqual([])
    expect(
      fromV1Event({
        type: "permission.replied",
        properties: { sessionID: "s", requestID: "r", reply: "maybe" },
      }),
    ).toEqual([])
    expect(fromV1Event(null)).toEqual([])
  })
})

describe("OpenCode 2", () => {
  const seen = lines("v2.jsonl").flatMap(fromV2Event)

  test("every event Trust uses, and nothing else", () => {
    expect(seen.map((s) => s.type)).toEqual(["agent", "call", "asked", "replied", "agent", "asked", "config"])
  })

  test("shell is bash, subagent is task, save is always", () => {
    expect(seen[2]).toEqual({
      type: "asked",
      request: {
        id: "per_1",
        sessionID: "ses_main",
        permission: "bash",
        patterns: ["git status", "bun test"],
        always: ["git status *", "bun test *"],
        call: "call_shell_1",
        messageID: "msg_asst",
      },
    })
    expect(seen[5]).toMatchObject({
      request: { permission: "task", patterns: ["explore"], call: "call_task_1" },
    })
  })

  test("a shell call's cwd is its working directory", () => {
    const call = seen[1]
    if (call?.type !== "call") throw new Error("no call")
    expect(commandOf(call.input)).toEqual({ line: "git status && bun test", workdir: "packages/web" })
  })

  test("the agent comes from the session's events", () => {
    expect(seen[0]).toEqual({ type: "agent", sessionID: "ses_main", agent: "build" })
    expect(seen[4]).toEqual({ type: "agent", sessionID: "ses_main", agent: "plan" })
  })

  test("a pending request read from a list", () => {
    const data = (lines("v2.jsonl")[2] as { details: { data: unknown } }).details.data
    expect(fromV2Pending([data])).toEqual([seen[2] as never])
  })
})
