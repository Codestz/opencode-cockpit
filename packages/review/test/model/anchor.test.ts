import { describe, expect, test } from "bun:test"
import { anchoredRange, anchorOf, hasDrifted, type Thread } from "../../src/core/model/thread.ts"

/**
 * The rule the whole staleness story rests on: a comment follows its code when the code merely
 * moves, and admits defeat when the code is gone. Getting these two confused is why an edit above a
 * thread used to make the thread look broken.
 */

const FILE = ["const a = 1", "", "function total() {", "  return 41", "}", "", "const z = 9"].join("\n")

const thread = (over: Partial<Thread> = {}): Thread => ({
  id: "rv_1",
  file: "a.ts",
  line: 3,
  through: 5,
  quoted: ["function total() {", "  return 41", "}"],
  entries: [{ author: "you", body: "off by one?", at: 1 }],
  status: "open",
  ...over,
})

describe("where a thread's code is now", () => {
  test("still there", () => {
    expect(anchorOf(thread(), FILE)).toEqual({ state: "current" })
    expect(hasDrifted(thread(), FILE)).toBe(false)
  })

  /** Two lines added above it: the same code, further down. The comment goes with it. */
  test("moved down by an edit above it", () => {
    const after = `import x from "y"\n\n${FILE}`
    expect(anchorOf(thread(), after)).toEqual({ state: "moved", line: 5, through: 7 })
    expect(anchoredRange(thread(), after)).toEqual({ from: 5, to: 7 })
  })

  test("moved up", () => {
    const after = FILE.split("\n").slice(2).join("\n")
    expect(anchorOf(thread(), after)).toEqual({ state: "moved", line: 1, through: 3 })
  })

  test("gone", () => {
    const after = ["const a = 1", "", "const z = 9"].join("\n")
    expect(anchorOf(thread(), after)).toEqual({ state: "outdated" })
    expect(hasDrifted(thread(), after)).toBe(true)
  })

  test("changed in place is gone, not moved", () => {
    const after = FILE.replace("return 41", "return 42")
    expect(anchorOf(thread(), after)).toEqual({ state: "outdated" })
  })

  /** A single line of `}` matches everywhere; a block does not. Re-anchoring to the wrong `}` is
   *  worse than admitting the comment is lost. */
  test("a one-line thread anchors on its own text, not on the first similar line", () => {
    const one = thread({ line: 5, through: undefined, quoted: ["}"] })
    const after = `function other() {\n}\n\n${FILE}`
    expect(anchorOf(one, after)).toEqual({ state: "moved", line: 2 })
  })

  test("a whole-file note has nothing to drift from", () => {
    const whole = thread({ line: undefined, through: undefined, quoted: undefined })
    expect(anchorOf(whole, "anything at all")).toEqual({ state: "current" })
    expect(anchorOf(whole, undefined)).toEqual({ state: "current" })
  })

  test("a file we cannot read leaves the thread where it was", () => {
    expect(anchorOf(thread(), undefined)).toEqual({ state: "current" })
    expect(anchoredRange(thread(), undefined)).toEqual({ from: 3, to: 5 })
  })

  test("an unmoved thread keeps the range it was written against", () => {
    expect(anchoredRange(thread(), FILE)).toEqual({ from: 3, to: 5 })
    const gone = ["const a = 1"].join("\n")
    expect(anchoredRange(thread(), gone)).toEqual({ from: 3, to: 5 })
  })
})
