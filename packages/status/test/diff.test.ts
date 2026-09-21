import { describe, expect, test } from "bun:test"
import { parseShortstat } from "../src/core/diff.ts"

describe("reading git diff --shortstat", () => {
  test("both halves of a normal change", () => {
    expect(parseShortstat(" 13 files changed, 125 insertions(+), 66 deletions(-)")).toEqual({
      files: 13,
      additions: 125,
      deletions: 66,
    })
  })

  /** The one that bit: a pattern wanting a comma after `insertions` never reaches the deletions. */
  test("deletions survive the (+) suffix", () => {
    expect(parseShortstat(" 1 file changed, 2 insertions(+), 3 deletions(-)")?.deletions).toBe(3)
  })

  test("additions only", () => {
    expect(parseShortstat(" 1 file changed, 2 insertions(+)")).toEqual({
      files: 1,
      additions: 2,
      deletions: 0,
    })
  })

  test("deletions only", () => {
    expect(parseShortstat(" 2 files changed, 7 deletions(-)")).toEqual({
      files: 2,
      additions: 0,
      deletions: 7,
    })
  })

  test("a single file is singular in git's own words", () => {
    expect(parseShortstat(" 1 file changed, 1 insertion(+)")).toEqual({
      files: 1,
      additions: 1,
      deletions: 0,
    })
  })

  test("nothing to report is not a zero, it is no answer", () => {
    expect(parseShortstat("")).toBeUndefined()
    expect(parseShortstat("fatal: not a git repository")).toBeUndefined()
  })
})
