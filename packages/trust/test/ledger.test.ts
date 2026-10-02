import { describe, expect, test } from "bun:test"
import {
  applyAll,
  DAY,
  type Event,
  emptyState,
  keyOf,
  parseLines,
  serialize,
  standing,
} from "../src/core/ledger.ts"

const SETTINGS = { threshold: 3, dangerExtra: 5, expireDays: 30 }
const FOLD = { expireMs: 30 * DAY }

let n = 0
function ev(
  type: "approved" | "rejected" | "auto",
  subject: string,
  at: number,
  more: Partial<Event> = {},
): Event {
  n++
  return {
    v: 1,
    at,
    type,
    request: `per_${n}`,
    session: "ses_1",
    permission: "bash",
    agent: "build",
    items: [{ subject }],
    ...(type === "auto" ? { rule: "trusted" } : {}),
    ...more,
  } as Event
}

const entryOf = (state: ReturnType<typeof emptyState>, subject: string, agent = "build") =>
  state.entries.get(keyOf("bash", agent, subject))

describe("the fold", () => {
  test("approvals in a row add up; a reject resets", () => {
    const state = applyAll(
      emptyState(),
      [ev("approved", "ls", 1), ev("approved", "ls", 2), ev("rejected", "ls", 3), ev("approved", "ls", 4)],
      FOLD,
    )
    const found = entryOf(state, "ls")
    expect(found?.streak).toBe(1)
    expect(found?.approvals).toBe(3)
    expect(found?.rejectedAt).toBe(3)
  })

  test("Trust's own answers are counted apart and never add to the streak", () => {
    const state = applyAll(
      emptyState(),
      [ev("approved", "ls", 1), ev("approved", "ls", 2), ev("approved", "ls", 3), ev("auto", "ls", 4)],
      FOLD,
    )
    expect(entryOf(state, "ls")?.streak).toBe(3)
    expect(entryOf(state, "ls")?.autos).toBe(1)
  })

  test("an outcome written by two windows counts once", () => {
    const one = ev("approved", "ls", 1)
    const state = applyAll(emptyState(), [one, { ...one, at: 2 }, ev("approved", "ls", 3)], FOLD)
    expect(entryOf(state, "ls")?.streak).toBe(2)
  })

  test("trust unused past the expiry starts again", () => {
    const later = 40 * DAY
    const state = applyAll(
      emptyState(),
      [
        ev("approved", "ls", 1),
        ev("approved", "ls", 2),
        ev("approved", "ls", 3),
        ev("approved", "ls", later),
      ],
      FOLD,
    )
    expect(entryOf(state, "ls")?.streak).toBe(1)
  })

  test("revoking takes the streak away; pause and resume are per project", () => {
    const state = applyAll(
      emptyState(),
      [
        ev("approved", "ls", 1),
        ev("approved", "ls", 2),
        { v: 1, at: 3, type: "revoked", permission: "bash", agent: "build", subject: "ls" },
        { v: 1, at: 4, type: "paused" },
      ],
      FOLD,
    )
    expect(entryOf(state, "ls")?.streak).toBe(0)
    expect(state.paused).toBe(true)
    applyAll(state, [{ v: 1, at: 5, type: "resumed" }], FOLD)
    expect(state.paused).toBe(false)
  })

  test("the agent is part of the key", () => {
    const state = applyAll(emptyState(), [ev("approved", "ls", 1, { agent: "general" })], FOLD)
    expect(entryOf(state, "ls", "build")).toBeUndefined()
    expect(entryOf(state, "ls", "general")?.streak).toBe(1)
  })

  test("OpenCode's own always is kept to show", () => {
    const state = applyAll(
      emptyState(),
      [ev("approved", "docker compose -p x up", 1, { always: ["docker compose -p *"] })],
      FOLD,
    )
    expect(state.always).toEqual([
      { at: 1, session: "ses_1", permission: "bash", agent: "build", patterns: ["docker compose -p *"] },
    ])
  })
})

describe("standing", () => {
  test("trusted at the threshold, dangerous at threshold + extra", () => {
    const state = applyAll(
      emptyState(),
      [1, 2, 3].map((at) => ev("approved", "x", at)),
      FOLD,
    )
    const found = entryOf(state, "x")
    expect(standing(found, undefined, SETTINGS, 4)).toEqual({
      have: 3,
      need: 3,
      trusted: true,
      expired: false,
    })
    expect(standing(found, "rm", SETTINGS, 4)).toEqual({ have: 3, need: 8, trusted: false, expired: false })
  })

  test("expired trust stands at nothing", () => {
    const state = applyAll(
      emptyState(),
      [1, 2, 3].map((at) => ev("approved", "x", at)),
      FOLD,
    )
    expect(standing(entryOf(state, "x"), undefined, SETTINGS, 31 * DAY)).toEqual({
      have: 0,
      need: 3,
      trusted: false,
      expired: true,
    })
    expect(standing(entryOf(state, "x"), undefined, { ...SETTINGS, expireDays: 0 }, 400 * DAY).trusted).toBe(
      true,
    )
  })
})

describe("the file", () => {
  const a = ev("approved", "ls", 1)
  const b = ev("approved", "pwd", 2)

  test("round trip", () => {
    expect(parseLines(serialize(a) + serialize(b)).events).toEqual([a, b])
  })

  test("a torn last line is left for later, not lost", () => {
    const text = serialize(a) + serialize(b).slice(0, 20)
    const { events, rest } = parseLines(text)
    expect(events).toEqual([a])
    expect(rest).toBe(serialize(b).slice(0, 20))
  })

  test("a line written after a torn one is recovered", () => {
    const torn = serialize(a).slice(0, 25)
    expect(parseLines(torn + serialize(b)).events).toEqual([b])
  })

  test("garbage and unknown events are skipped", () => {
    const text = `not json\n{"v":2,"at":1,"type":"approved"}\n{"v":1,"at":1,"type":"widened"}\n${serialize(a)}`
    expect(parseLines(text).events).toEqual([a])
  })

  test("a subject with a newline stays on one line", () => {
    const odd = ev("approved", "echo 'a\nb'", 3)
    expect(serialize(odd).split("\n")).toHaveLength(2)
    expect(parseLines(serialize(odd)).events).toEqual([odd])
  })
})
