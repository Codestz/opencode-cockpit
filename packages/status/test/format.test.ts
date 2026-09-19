import { describe, expect, test } from "bun:test"
import {
  bar,
  basename,
  compact,
  duration,
  money,
  percent,
  preciseDuration,
  shortModel,
  shortPath,
  truncate,
  truncateStart,
} from "../src/core/format.ts"

describe("compact numbers", () => {
  test("stays exact below a thousand, then abbreviates", () => {
    expect(compact(0)).toBe("0")
    expect(compact(999)).toBe("999")
    expect(compact(1000)).toBe("1k")
    expect(compact(1234)).toBe("1.2k")
    expect(compact(999_999)).toBe("1000k")
    expect(compact(1_500_000)).toBe("1.5M")
    expect(compact(2_000_000_000)).toBe("2B")
  })

  test("a round abbreviation drops its decimal", () => {
    expect(compact(2000)).toBe("2k")
    expect(compact(2_000_000)).toBe("2M")
  })
})

describe("money", () => {
  // The point of the segment is to be trusted; "$0.00" on real spend would break that.
  test("sub-cent spend is not reported as nothing", () => {
    expect(money(0.004)).toBe("<$0.01")
    expect(money(0)).toBe("$0")
  })

  test("cents matter while the amount is small, and stop mattering when it is not", () => {
    expect(money(0.42)).toBe("$0.42")
    expect(money(12.5)).toBe("$12.50")
    expect(money(124.4)).toBe("$124")
  })

  test("another currency keeps the same shape", () => {
    expect(money(3.5, "€")).toBe("€3.50")
  })
})

describe("duration", () => {
  test("coarsens as it grows", () => {
    expect(duration(0)).toBe("0s")
    expect(duration(4500)).toBe("4s")
    expect(duration(59_000)).toBe("59s")
    expect(duration(60_000)).toBe("1m")
    expect(duration(3_540_000)).toBe("59m")
    expect(duration(3_600_000)).toBe("1h")
    expect(duration(7_500_000)).toBe("2h 5m")
  })

  test("negative time reads as none rather than as a minus sign", () => {
    expect(duration(-5000)).toBe("0s")
  })
})

describe("precise duration", () => {
  test("drops each tier as it stops mattering", () => {
    expect(preciseDuration(42_000)).toBe("42s")
    expect(preciseDuration(222_000)).toBe("3m42s")
    expect(preciseDuration(3_600_000)).toBe("1h00m")
    expect(preciseDuration(8_100_000)).toBe("2h15m")
  })

  // "61h48m" is a number nobody converts in their head.
  test("past a day it counts days, not hours", () => {
    expect(preciseDuration(222_480_000)).toBe("2d 13h")
    expect(preciseDuration(86_400_000)).toBe("1d")
    expect(preciseDuration(90_000_000)).toBe("1d 1h")
  })
})

describe("the context bar", () => {
  test("is always exactly the width it was asked for", () => {
    for (const ratio of [0, 0.01, 0.33, 0.5, 0.99, 1]) {
      expect(bar(ratio, 8)).toHaveLength(8)
    }
    expect(bar(0.5, 0)).toBe("")
  })

  test("fills from empty to full", () => {
    expect(bar(0, 4)).toBe("    ")
    expect(bar(1, 4)).toBe("████")
    expect(bar(0.5, 4).startsWith("██")).toBe(true)
  })

  test("a ratio outside 0..1 is clamped rather than overflowing the line", () => {
    expect(bar(-1, 4)).toBe("    ")
    expect(bar(5, 4)).toBe("████")
  })
})

describe("percent", () => {
  test("rounds to whole numbers", () => {
    expect(percent(0)).toBe("0%")
    expect(percent(0.756)).toBe("76%")
    expect(percent(1)).toBe("100%")
  })
})

describe("paths", () => {
  const home = "/Users/x"
  const worktree = "/Users/x/code/app"

  test("the worktree root is named, not blank", () => {
    expect(shortPath(worktree, worktree, home)).toBe("app")
  })

  test("inside the worktree is relative", () => {
    expect(shortPath("/Users/x/code/app/src/tui", worktree, home)).toBe("src/tui")
  })

  test("elsewhere under home uses a tilde", () => {
    expect(shortPath("/Users/x/other", worktree, home)).toBe("~/other")
    expect(shortPath("/Users/x", worktree, home)).toBe("~")
  })

  test("anywhere else stays a plain path", () => {
    expect(shortPath("/etc/nginx", worktree, home)).toBe("/etc/nginx")
  })

  test("a trailing slash does not change the answer", () => {
    expect(shortPath("/Users/x/code/app/", `${worktree}/`, home)).toBe("app")
  })

  test("basename survives a root path", () => {
    expect(basename("/")).toBe("/")
    expect(basename("/a/b/")).toBe("b")
  })
})

describe("model names", () => {
  test("drops the vendor prefix and the build date", () => {
    expect(shortModel("anthropic/claude-opus-5-20260101")).toBe("claude-opus-5")
    expect(shortModel("claude-haiku-4-5-20251001")).toBe("claude-haiku-4-5")
    expect(shortModel("gpt-5-latest")).toBe("gpt-5")
  })

  test("leaves a name that carries neither alone", () => {
    expect(shortModel("my-proxy-model")).toBe("my-proxy-model")
  })
})

describe("truncateStart", () => {
  // A path's tail is what identifies it, so that is the half worth keeping.
  test("keeps the end and marks the cut", () => {
    expect(truncateStart("/a/b/c/src/tui", 9)).toBe("…/src/tui")
    expect(truncateStart("/a/b/c/src/tui", 9)).toHaveLength(9)
    expect(truncateStart("short", 9)).toBe("short")
    expect(truncateStart("abc", 1)).toBe("…")
    expect(truncateStart("abc", 0)).toBe("")
  })
})

describe("truncate", () => {
  test("never exceeds the budget", () => {
    expect(truncate("abcdef", 4)).toBe("abc…")
    expect(truncate("abcdef", 4)).toHaveLength(4)
    expect(truncate("ab", 4)).toBe("ab")
    expect(truncate("abc", 1)).toBe("…")
    expect(truncate("abc", 0)).toBe("")
  })
})
