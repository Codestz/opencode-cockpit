import { describe, expect, test } from "bun:test"
import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import type { RGBA } from "@opentui/core"
import { inkOn } from "../../src/tui/view/pool.ts"

/**
 * A badge is a word cut out of a block of colour, and a theme can swallow the word two ways: by
 * leaving its background transparent, so the ink paints nothing, or by setting a background so near
 * the accent that the two do not read apart. Both showed up on real machines as a bare coloured
 * block where ` YOU ` should be. The ink is therefore chosen, and this is what it must choose.
 */

const colour = (r: number, g: number, b: number, a = 1): RGBA => ({ r, g, b, a }) as RGBA

const themeOf = (over: Partial<Record<string, RGBA>>): TuiThemeCurrent =>
  ({
    background: colour(0.04, 0.05, 0.06),
    backgroundPanel: colour(0.08, 0.09, 0.1),
    backgroundElement: colour(0.14, 0.15, 0.16),
    text: colour(0.86, 0.9, 0.93),
    ...over,
  }) as unknown as TuiThemeCurrent

const teal = colour(0.36, 0.83, 0.76)

describe("ink for a badge", () => {
  test("a dark theme prints the badge in its own background", () => {
    const theme = themeOf({})
    expect(inkOn(theme, teal)).toBe(theme.background as RGBA)
  })

  test("a transparent background is skipped, not painted with", () => {
    const theme = themeOf({ background: colour(0, 0, 0, 0) })
    expect(inkOn(theme, teal)).toBe(theme.backgroundPanel as RGBA)
  })

  /** Nothing opaque behind the panel either, so the last candidate left is the text colour. */
  test("when every background is transparent the ink falls through to the text colour", () => {
    const theme = themeOf({
      background: colour(0, 0, 0, 0),
      backgroundPanel: colour(0, 0, 0, 0),
      backgroundElement: colour(0, 0, 0, 0),
    })
    expect(inkOn(theme, colour(0.15, 0.2, 0.5))).toBe(theme.text as RGBA)
  })

  test("a light theme prints the badge in its text colour, not its background", () => {
    const theme = themeOf({
      background: colour(0.98, 0.98, 0.98),
      backgroundPanel: colour(0.95, 0.95, 0.95),
      backgroundElement: colour(0.92, 0.92, 0.92),
      text: colour(0.1, 0.11, 0.12),
    })
    expect(inkOn(theme, colour(0.85, 0.7, 0.2))).toBe(theme.text as RGBA)
  })

  /** No colour in the theme reads on this block, so the caller drops the block instead. */
  test("a theme with nothing that contrasts gives no ink at all", () => {
    const grey = colour(0.5, 0.5, 0.5)
    const theme = themeOf({
      background: grey,
      backgroundPanel: grey,
      backgroundElement: grey,
      text: colour(0.55, 0.55, 0.55),
    })
    expect(inkOn(theme, grey)).toBeUndefined()
  })

  test("a block that paints nothing takes the first ink that does", () => {
    const theme = themeOf({ background: colour(0, 0, 0, 0) })
    expect(inkOn(theme, undefined)).toBe(theme.backgroundPanel as RGBA)
    expect(inkOn(theme, colour(0.4, 0.4, 0.4, 0))).toBe(theme.backgroundPanel as RGBA)
  })

  test("ints are read as ints, not as a colour brighter than white", () => {
    const theme = themeOf({ background: colour(10, 12, 14), text: colour(220, 230, 240) })
    expect(inkOn(theme, colour(92, 212, 194))).toBe(theme.background as RGBA)
  })
})
