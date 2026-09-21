import { describe, expect, test } from "bun:test"
import { splitMatches } from "../src/tui/lib/search.ts"

describe("log search highlighting", () => {
  test("splits a line into plain and matching parts, ignoring case", () => {
    expect(splitMatches("FAIL src/auth.test.ts", "fail")).toEqual([
      { text: "FAIL", match: true },
      { text: " src/auth.test.ts", match: false },
    ])
    expect(splitMatches("a-b-a", "a")).toEqual([
      { text: "a", match: true },
      { text: "-b-", match: false },
      { text: "a", match: true },
    ])
    expect(splitMatches("nothing here", "zzz")).toEqual([{ text: "nothing here", match: false }])
    expect(splitMatches("plain", "")).toEqual([{ text: "plain", match: false }])
  })
})
