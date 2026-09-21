import { describe, expect, test } from "bun:test"
import { createMeter } from "../../src/core/perf.ts"

/**
 * The meter is the thing every later optimisation will be judged by, so it has to be right before any
 * of them are believed.
 */

/**
 * A clock the test moves by hand, advanced by the work being timed.
 *
 * Counting how many times the meter reads the clock — construction reads it too — made the first draft
 * of these tests a puzzle about the helper rather than about the meter.
 */
const clockOf = () => {
  let now = 0
  return {
    read: () => now,
    /** Called *inside* the timed work, so the elapsed time is whatever the test says it is. */
    spend: (ms: number) => {
      now += ms
    },
  }
}

describe("counting", () => {
  test("starts at zero for everything, so a snapshot is never a surprise", () => {
    const snapshot = createMeter(() => 0).snapshot()
    expect(snapshot.counts.paints).toBe(0)
    expect(snapshot.counts.errors).toBe(0)
    expect(snapshot.phases.paint.runs).toBe(0)
  })

  test("counts, and counts by more than one where that is the honest number", () => {
    const meter = createMeter(() => 0)
    meter.count("paints")
    meter.count("paints")
    meter.count("lines", 48)
    expect(meter.snapshot().counts.paints).toBe(2)
    expect(meter.snapshot().counts.lines).toBe(48)
  })

  test("reset puts it back, so a measurement can start where you decide", () => {
    const meter = createMeter(() => 0)
    meter.count("keys", 9)
    meter.reset()
    expect(meter.snapshot().counts.keys).toBe(0)
  })
})

describe("timing", () => {
  test("measures what it wraps and hands the result back untouched", () => {
    const clock = clockOf()
    const meter = createMeter(clock.read)
    const drawn = meter.time("paint", () => {
      clock.spend(5)
      return "drawn"
    })
    expect(drawn).toBe("drawn")
    expect(meter.snapshot().phases.paint.p50).toBe(5)
  })

  /** A frame that throws is exactly the frame worth knowing the cost of. */
  test("still records when the work throws, and lets the throw through", () => {
    const clock = clockOf()
    const meter = createMeter(clock.read)
    expect(() =>
      meter.time("paint", () => {
        clock.spend(3)
        throw new Error("row 41")
      }),
    ).toThrow("row 41")
    expect(meter.snapshot().phases.paint.runs).toBe(1)
    expect(meter.snapshot().phases.paint.worst).toBe(3)
  })

  test("a spread is the shape of the samples, not just their average", () => {
    /** Ten frames, one of them slow: the mean hides it and the worst does not. */
    const clock = clockOf()
    const meter = createMeter(clock.read)
    for (let index = 0; index < 10; index++) meter.time("paint", () => clock.spend(index === 9 ? 40 : 1))
    const { paint } = meter.snapshot().phases
    expect(paint.runs).toBe(10)
    expect(paint.p50).toBe(1)
    expect(paint.worst).toBe(40)
    expect(paint.mean).toBeGreaterThan(1)
    expect(paint.mean).toBeLessThan(40)
  })

  /** The one slow frame is the whole reason for looking, so it may not fall out of the window. */
  test("the worst is remembered after the sample that held it is forgotten", () => {
    const clock = clockOf()
    const meter = createMeter(clock.read)
    meter.time("build", () => clock.spend(99))
    for (let index = 0; index < 400; index++) meter.time("build", () => clock.spend(1))
    expect(meter.snapshot().phases.build.worst).toBe(99)
    expect(meter.snapshot().phases.build.runs).toBe(401)
    expect(meter.snapshot().phases.build.p50).toBe(1)
  })

  test("holds a fixed number of samples however long it runs", () => {
    const meter = createMeter(() => 0)
    for (let index = 0; index < 10_000; index++) meter.time("layout", () => undefined)
    /** Every sample is zero here; what matters is that it answered at all, and counted them all. */
    expect(meter.snapshot().phases.layout.runs).toBe(10_000)
    expect(meter.snapshot().phases.layout.p99).toBe(0)
  })
})
