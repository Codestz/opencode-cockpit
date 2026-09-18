import { describe, expect, test } from "bun:test"
import { cacheDirFor, isNewer, shouldCheck } from "../src/tui/update.ts"

describe("update notice", () => {
  test("checks at most once a day", () => {
    const now = 1_000_000_000
    expect(shouldCheck(undefined, now)).toBe(true)
    expect(shouldCheck(now - 60_000, now)).toBe(false)
    expect(shouldCheck(now - 25 * 60 * 60 * 1000, now)).toBe(true)
  })

  test("only a higher release counts as newer", () => {
    expect(isNewer("0.1.6", "0.1.5")).toBe(true)
    expect(isNewer("0.2.0", "0.1.9")).toBe(true)
    expect(isNewer("1.0.0", "0.9.9")).toBe(true)
    expect(isNewer("0.1.5", "0.1.5")).toBe(false)
    expect(isNewer("0.1.4", "0.1.5")).toBe(false)
    expect(isNewer("0.2.0-beta.1", "0.1.9")).toBe(true)
    expect(isNewer("0.1.5-beta.1", "0.1.5")).toBe(false)
    expect(isNewer("0.1.5", "0.1.5-beta.1")).toBe(true)
    expect(isNewer("garbage", "0.1.5")).toBe(false)
  })

  test("the cache entry is the folder holding node_modules, and only for npm installs", () => {
    const target =
      "/Users/me/.cache/opencode/packages/@opencode-cockpit/shell@latest/node_modules/@opencode-cockpit/shell"
    expect(cacheDirFor(target, "npm")).toBe(
      "/Users/me/.cache/opencode/packages/@opencode-cockpit/shell@latest",
    )
    expect(cacheDirFor(target, "file")).toBeUndefined()
    expect(cacheDirFor("/repo/packages/shell", "npm")).toBeUndefined()
    expect(cacheDirFor(undefined, "npm")).toBeUndefined()
  })
})
