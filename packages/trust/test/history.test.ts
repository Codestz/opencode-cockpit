import { describe, expect, test } from "bun:test"
import { createEngine } from "../src/core/engine.ts"
import { answersPerDay, dayOf, earned, latestAnswers, MARKS, type Mark } from "../src/core/history.ts"
import { DAY, type Event } from "../src/core/ledger.ts"

const SETTINGS = { threshold: 3, dangerExtra: 5, expireDays: 30 }
/** Noon today, so a few hours either way stays on the same local day. */
const NOW = dayOf(Date.UTC(2026, 8, 20)) + 12 * 3_600_000

let n = 0
const about = (subject: string, agent = "build") => ({
  request: `per_${++n}`,
  session: "ses",
  permission: "bash",
  agent,
  items: [{ subject }],
})
const approved = (at: number, subject = "ls"): Event => ({ v: 1, at, type: "approved", ...about(subject) })
const rejected = (at: number, subject = "ls"): Event => ({ v: 1, at, type: "rejected", ...about(subject) })
const auto = (at: number, subject = "ls"): Event => ({
  v: 1,
  at,
  type: "auto",
  rule: "approved by you 3× in a row",
  ...about(subject),
})
const marksOf = (engine: ReturnType<typeof createEngine>, subject = "ls") =>
  engine.history.marks.get(JSON.stringify(["bash", subject])) ?? []

describe("history: when things happened, beside the state", () => {
  test("a rule's moments, a run of answers as one with a count", () => {
    const engine = createEngine(SETTINGS)
    engine.load([approved(NOW - 3000), approved(NOW - 2000), approved(NOW - 1000), auto(NOW), auto(NOW + 10)])
    expect(marksOf(engine).map((mark) => mark.kind)).toEqual(["approved", "approved", "approved", "auto"])
    expect((marksOf(engine).at(-1) as Extract<Mark, { kind: "auto" }>).count).toBe(2)
  })

  test("two windows writing one outcome are one moment, as in the state", () => {
    const engine = createEngine(SETTINGS)
    const once = approved(NOW)
    engine.load([once, { ...once, at: NOW + 5 }])
    expect(marksOf(engine)).toHaveLength(1)
    expect(engine.state.entries.values().next().value?.approvals).toBe(1)
  })

  test("bounded: the newest moments per rule, and answers per day for the last days", () => {
    const engine = createEngine(SETTINGS)
    engine.load(Array.from({ length: MARKS * 2 }, (_, i) => (i % 2 ? rejected(NOW + i) : approved(NOW + i))))
    expect(marksOf(engine)).toHaveLength(MARKS)
    expect(marksOf(engine).at(-1)?.at).toBe(NOW + MARKS * 2 - 1)
  })

  test("answers per day: the last seven, today last; the feed newest first", () => {
    const engine = createEngine(SETTINGS)
    engine.load([auto(NOW - 2 * DAY), auto(NOW - 2 * DAY + 60_000), auto(NOW - 60_000), auto(NOW)])
    expect(answersPerDay(engine.history, NOW)).toEqual([0, 0, 0, 0, 2, 0, 2])
    expect(latestAnswers(engine.history).map((answer) => answer.at)).toEqual([
      NOW,
      NOW - 60_000,
      NOW - 2 * DAY + 60_000,
      NOW - 2 * DAY,
    ])
  })

  test("earned: when a streak reached what it needed, and what broke one", () => {
    const marks: Mark[] = [
      { kind: "approved", at: 1 },
      { kind: "rejected", at: 2 },
      { kind: "approved", at: 3 },
      { kind: "approved", at: 4 },
      { kind: "approved", at: 5 },
      { kind: "auto", at: 6, count: 4 },
    ]
    expect(earned(marks, 3, 0)).toEqual({ streak: 3, since: 5, brokenAt: 2, broken: "rejected" })
    expect(earned(marks, 3, 0, 4)).toEqual({ streak: 2, brokenAt: 2, broken: "rejected" })
    /** Unused longer than the expiry, the next approval starts over — as the state folds it. */
    expect(
      earned(
        [
          { kind: "approved", at: 1 },
          { kind: "approved", at: 1 + 31 * DAY },
        ],
        3,
        30 * DAY,
      ),
    ).toEqual({
      streak: 1,
      brokenAt: 1 + 31 * DAY,
      broken: "expired",
    })
  })

  test("a reload from the file builds the same history", () => {
    const events = [approved(NOW - 3000), approved(NOW - 2000), approved(NOW - 1000), auto(NOW)]
    const one = createEngine(SETTINGS)
    one.load(events)
    const two = createEngine(SETTINGS)
    two.load(events.slice(0, 2))
    two.load(events, { reset: true })
    expect([...two.history.marks]).toEqual([...one.history.marks])
    two.reset(SETTINGS)
    expect([...two.history.marks]).toEqual([...one.history.marks])
  })
})
