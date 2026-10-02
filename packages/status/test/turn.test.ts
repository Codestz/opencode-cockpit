/**
 * `session.time` used to count from the session's creation and say so with a bare number, so a
 * conversation reopened two days later read `2d 15h` on every frame. The built-in lines now ask how
 * long the last answer took; a line someone wrote keeps the clock it had.
 */

import { describe, expect, test } from "bun:test"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { V2Context } from "@opencode-cockpit/client/host"
import { DEFAULT_SEGMENTS, PRESETS, type SegmentConfig } from "../src/core/config.ts"
import { lastTurn, type SessionSnapshot, type StatusContext } from "../src/core/context.ts"
import { buildSegments, segmentText } from "../src/core/segments.ts"
import { sessionSnapshot, sessionSnapshotV2 } from "../src/tui/state/snapshot.ts"

const NOW = 2 * 24 * 3600_000 + 15 * 3600_000

const session = (over: Partial<SessionSnapshot> = {}): SessionSnapshot => ({
  id: "ses_1",
  status: "idle",
  cost: 0,
  priced: false,
  messages: 4,
  startedAt: 0,
  turn: { startedAt: NOW - 360_000, endedAt: NOW - 360_000 + 222_000 },
  diff: { files: 0, additions: 0, deletions: 0 },
  todo: { total: 0, completed: 0 },
  ...over,
})

const ctx = (over: Partial<SessionSnapshot> = {}): StatusContext => ({
  now: NOW,
  directory: "/w/app",
  worktree: "/w/app",
  home: "/home/u",
  version: "0.8.0",
  lsp: [],
  mcp: [],
  commands: {},
  width: 120,
  session: session(over),
})

const draw = (context: StatusContext, config: Record<string, unknown> = {}, icons = false) => {
  const [segment] = buildSegments(context, [{ type: "session.time", ...config }], { icons })
  return segment ? segmentText(segment) : undefined
}

describe("which turn is the last one", () => {
  test("no prompt yet is no turn, not a turn of zero", () => {
    expect(lastTurn([])).toBeUndefined()
    expect(lastTurn([{ role: "assistant", created: 1, completed: 2 }])).toBeUndefined()
  })

  test("from the last prompt to the last reply after it that finished", () => {
    const turn = lastTurn([
      { role: "user", created: 100 },
      { role: "assistant", created: 110, completed: 500 },
      { role: "user", created: 1_000 },
      { role: "assistant", created: 1_010, completed: 1_400 },
      { role: "other", created: 1_450 },
      { role: "assistant", created: 1_410, completed: 2_000 },
      { role: "assistant", created: 2_010 },
    ])
    expect(turn).toEqual({ startedAt: 1_000, endedAt: 2_000 })
  })

  test("a prompt nothing has finished answering has a start and no end", () => {
    expect(
      lastTurn([
        { role: "user", created: 1_000 },
        { role: "assistant", created: 1_010 },
      ]),
    ).toEqual({
      startedAt: 1_000,
    })
  })
})

describe("session.time", () => {
  test("by default it is still the session's age, bare, for the lines already written", () => {
    expect(draw(ctx())).toBe("2d 15h")
    expect(draw(ctx(), {}, true)).toBe("◷ 2d 15h")
    expect(draw(ctx(), { coarse: true })).toBe("63h")
  })

  test('`of: "turn"` says how long the last answer took, and says that it is that', () => {
    expect(draw(ctx(), { of: "turn" })).toBe("took 3m42s")
    expect(draw(ctx(), { of: "turn", coarse: true })).toBe("took 3m")
  })

  test('`of: "turn"` is silent while a turn runs: session.status is counting that one', () => {
    expect(draw(ctx({ status: "busy" }), { of: "turn" })).toBeUndefined()
    expect(draw(ctx({ status: "retry" }), { of: "turn" })).toBeUndefined()
  })

  test('`of: "turn"` is silent before the first answer, and for a turn nothing finished', () => {
    expect(draw(ctx({ turn: undefined }), { of: "turn" })).toBeUndefined()
    expect(draw(ctx({ turn: { startedAt: NOW - 5_000 } }), { of: "turn" })).toBeUndefined()
  })

  test("every built-in line uses the turn, never the session's age", () => {
    const lines = [DEFAULT_SEGMENTS, ...Object.values(PRESETS).map((preset) => preset.segments)]
    const times = lines
      .flat()
      .filter((s): s is SegmentConfig => typeof s !== "string" && s.type === "session.time")
    expect(times.length).toBeGreaterThan(0)
    for (const each of times) expect(each.of).toBe("turn")
    for (const line of lines) expect(line).not.toContain("session.time")
  })
})

describe("both OpenCodes say when a turn started and ended", () => {
  test("v1: user and assistant messages carry time.created and time.completed", () => {
    const api = {
      state: {
        session: {
          get: () => ({ title: "t", time: { created: 1 } }),
          messages: () => [
            { role: "user", time: { created: 1_000 } },
            { role: "assistant", time: { created: 1_010, completed: 4_000 }, cost: 0 },
          ],
          status: () => ({ type: "idle" }),
          todo: () => [],
        },
        provider: [],
      },
    } as unknown as TuiPluginApi
    const snapshot = sessionSnapshot(api, "ses_1", 9_000, { files: 0, additions: 0, deletions: 0 })
    expect(snapshot.turn).toEqual({ startedAt: 1_000, endedAt: 4_000 })
    expect(snapshot.startedAt).toBe(1)
  })

  test("v2: messages are typed by `type`, with the same two times", () => {
    const v2 = {
      location: {},
      data: {
        session: {
          get: () => ({ title: "t", time: { created: 1 } }),
          status: () => ({ type: "busy" }),
          message: {
            list: () => [
              { type: "user", time: { created: 2_000 } },
              { type: "assistant", time: { created: 2_010, completed: 2_500 } },
              { type: "assistant", time: { created: 2_510 } },
            ],
          },
        },
        location: { model: { list: () => [] } },
      },
    } as unknown as V2Context
    const snapshot = sessionSnapshotV2(v2, "ses_1", 9_000, { files: 0, additions: 0, deletions: 0 })
    expect(snapshot.turn).toEqual({ startedAt: 2_000, endedAt: 2_500 })
    expect(snapshot.status).toBe("busy")
  })
})
