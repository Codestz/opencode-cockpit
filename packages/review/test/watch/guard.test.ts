import { describe, expect, test } from "bun:test"
import { createGuard, type Trouble } from "../../src/core/guard.ts"
import { createMeter } from "../../src/core/perf.ts"

/**
 * The review had no error handling at all: every command, click and paint ran unguarded, so one row
 * that threw either took the surface down or vanished into the host. These tests are that hole,
 * closed — and they are about *behaviour under failure*, which is the one thing you cannot check by
 * reading code that has never failed.
 */

const setup = (options: { quiet?: number; now?: () => number } = {}) => {
  const told: { trouble: Trouble; detail: string }[] = []
  const meter = createMeter(() => 0)
  const guard = createGuard({
    meter,
    report: (trouble, detail) => told.push({ trouble, detail }),
    context: () => "pane diff  file layout.ts  line 41",
    ...options,
  })
  return { guard, meter, told }
}

describe("when something throws", () => {
  test("the throw stops here, and the caller carries on", () => {
    const { guard } = setup()
    expect(() =>
      guard.run("comment", () => {
        throw new Error("no file")
      }),
    ).not.toThrow()
  })

  test("work that succeeded is handed back untouched", () => {
    const { guard, told } = setup()
    expect(guard.run("enter", () => 41)).toBe(41)
    expect(told).toHaveLength(0)
  })

  test("it is counted, so the footer can say the review is unwell", () => {
    const { guard, meter } = setup()
    guard.run("paint", () => {
      throw new Error("bad row")
    })
    expect(meter.snapshot().counts.errors).toBe(1)
  })

  test("it is reported with the stack and what was happening", () => {
    const { guard, told } = setup()
    guard.run("paint", () => {
      throw new Error("bad row")
    })
    const said = told[0]
    expect(said?.trouble.where).toBe("paint")
    expect(said?.trouble.message).toBe("bad row")
    expect(said?.detail).toContain("bad row")
    expect(said?.detail).toContain("line 41")
    /** A stack is the whole point: without one, "it crashes sometimes" stays unfalsifiable. */
    expect(said?.detail).toContain("guard.test.ts")
  })

  test("the last trouble is available for the footer to show", () => {
    const { guard } = setup()
    guard.run("scroll", () => {
      throw new Error("off the end")
    })
    expect(guard.last()?.message).toBe("off the end")
    guard.clear()
    expect(guard.last()).toBeUndefined()
  })

  test("something that is not an Error is still said out loud", () => {
    const { guard, told } = setup()
    guard.run("odd", () => {
      throw "a string, thrown"
    })
    expect(told[0]?.trouble.message).toBe("a string, thrown")
  })
})

/**
 * A row that throws throws on every paint — sixty times a second. Reporting each one would drown the
 * log, bury the first occurrence, and make the toast into a strobe.
 */
describe("when the same thing keeps throwing", () => {
  test("it is told once, counted every time", () => {
    const { guard, meter, told } = setup({ quiet: 5_000, now: () => 0 })
    for (let index = 0; index < 60; index++)
      guard.run("paint", () => {
        throw new Error("bad row")
      })
    expect(told).toHaveLength(1)
    expect(meter.snapshot().counts.errors).toBe(60)
    expect(guard.last()?.seen).toBe(60)
  })

  test("and said again once it has gone quiet, in case it is still happening", () => {
    let now = 0
    const { guard, told } = setup({ quiet: 5_000, now: () => now })
    const fail = () =>
      guard.run("paint", () => {
        throw new Error("bad row")
      })
    fail()
    now = 4_000
    fail()
    expect(told).toHaveLength(1)
    now = 9_001
    fail()
    expect(told).toHaveLength(2)
  })

  test("two different troubles are two reports, not one", () => {
    const { guard, told } = setup()
    guard.run("paint", () => {
      throw new Error("bad row")
    })
    guard.run("click", () => {
      throw new Error("no such file")
    })
    expect(told).toHaveLength(2)
  })
})

describe("work that happens on its own", () => {
  test("a rejected promise is trouble too, and does not become an unhandled one", async () => {
    const { guard, told, meter } = setup()
    guard.task("refresh", () => Promise.reject(new Error("git said no")))
    await Promise.resolve()
    await Promise.resolve()
    expect(meter.snapshot().counts.errors).toBe(1)
    expect(told[0]?.trouble.where).toBe("refresh")
  })

  test("a reporter that throws is not allowed to become the problem", () => {
    const meter = createMeter(() => 0)
    const guard = createGuard({
      meter,
      report: () => {
        throw new Error("the log is broken too")
      },
    })
    expect(() =>
      guard.run("paint", () => {
        throw new Error("bad row")
      }),
    ).not.toThrow()
    expect(meter.snapshot().counts.errors).toBe(1)
  })
})
