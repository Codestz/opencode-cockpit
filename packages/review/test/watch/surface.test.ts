import { describe, expect, test } from "bun:test"
import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import { solidSurface } from "../../src/tui/view/pool.ts"

/** Just enough of OpenTUI's colour: channels 0..1, and the class a fallback is built from. */
class Colour {
  constructor(
    readonly r: number,
    readonly g: number,
    readonly b: number,
    readonly a: number,
    readonly hex = "",
  ) {}
  static fromHex(hex: string): Colour {
    return new Colour(0, 0, 0, 1, hex)
  }
}
const clear = new Colour(0, 0, 0, 0)
const theme = (over: Partial<Record<string, Colour>>) =>
  ({
    text: new Colour(0.9, 0.9, 0.9, 1),
    background: clear,
    backgroundPanel: clear,
    backgroundElement: clear,
    ...over,
  }) as unknown as TuiThemeCurrent

describe("a surface that has to cover what is under it", () => {
  test("uses the theme's own background when it paints", () => {
    const solid = new Colour(0.1, 0.1, 0.1, 1)
    expect(solidSurface(theme({ background: solid }))).toBe(solid as never)
  })

  /** OpenCode's "system" theme: every background transparent, so the terminal shows through. */
  test("skips transparent backgrounds for the next one that paints", () => {
    const panel = new Colour(0.2, 0.2, 0.2, 1)
    expect(solidSurface(theme({ backgroundPanel: panel }))).toBe(panel as never)
  })

  test("with none that paint, falls back to a solid colour against the text", () => {
    expect((solidSurface(theme({})) as unknown as Colour).hex).toBe("#0b0b0e")
    const dark = theme({ text: new Colour(0.1, 0.1, 0.1, 1) })
    expect((solidSurface(dark) as unknown as Colour).hex).toBe("#fafafa")
  })
})
