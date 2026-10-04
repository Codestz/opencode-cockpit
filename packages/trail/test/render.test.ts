import { describe, expect, test } from "bun:test"
import type { Theme } from "@opencode-cockpit/client/host"
import { RGBA } from "@opentui/core"
import { TINTS } from "../src/core/view/rows.ts"
import { fillColour, toneColour } from "../src/tui/render.ts"

const hex = (value: string) => RGBA.fromHex(value)
/** A theme with a colour of its own for every name the renderer reads, so each mapping is visible. */
const theme = (over: Partial<Record<string, RGBA>> = {}) =>
  ({
    text: hex("#eeeeee"),
    textMuted: hex("#808080"),
    accent: hex("#5c9cf5"),
    info: hex("#56b6c2"),
    primary: hex("#fab283"),
    success: hex("#7fd88f"),
    error: hex("#e06c75"),
    warning: hex("#f5a742"),
    border: hex("#484848"),
    background: hex("#0a0a0a"),
    backgroundPanel: hex("#141414"),
    backgroundElement: hex("#1e1e1e"),
    ...over,
  }) as unknown as Theme
const clear = RGBA.fromValues(0, 0, 0, 0)

describe("a tone is the theme's colour of that name", () => {
  const t = theme()
  test.each([
    ["muted", t.textMuted],
    ["accent", t.accent],
    ["info", t.info],
    ["tool", t.primary],
    ["success", t.success],
    ["error", t.error],
    ["warning", t.warning],
    ["border", t.border],
    ["text", t.text],
    [undefined, t.text],
  ] as const)("%s", (tone, colour) => {
    expect(toneColour(t, tone)).toBe(colour)
  })

  test("ink is what the dialog is drawn on: the panel, else the background, else the text", () => {
    const t = theme()
    expect(toneColour(t, "ink")).toBe(t.backgroundPanel)
    const noPanel = theme({ backgroundPanel: clear })
    expect(toneColour(noPanel, "ink")).toBe(noPanel.background)
    const bare = theme({ backgroundPanel: clear, background: clear })
    expect(toneColour(bare, "ink")).toBe(bare.text)
  })
})

describe("a fill is what sits behind a run", () => {
  test("rows and buttons are the raised element; a focused button is the accent; none is nothing", () => {
    const t = theme()
    for (const fill of ["selected", "panel", "button"] as const)
      expect(fillColour(t, fill)).toBe(t.backgroundElement)
    expect(fillColour(t, "buttonOn")).toBe(t.accent)
    expect(fillColour(t, "none")).toBeUndefined()
    expect(fillColour(t, undefined)).toBeUndefined()
  })

  // a colour keeps each channel as a whole number out of 255, so a mix lands within one step of exact
  test("a chip or a badge is its tone faded into the dialog, by its TINTS amount", () => {
    const t = theme()
    for (const fill of ["chip", "ok", "warn", "err"] as const) {
      const { tone, amount } = TINTS[fill]
      const colour = toneColour(t, tone)
      const behind = t.backgroundPanel
      const got = fillColour(t, fill) as RGBA
      expect(got.r).toBeCloseTo(behind.r + (colour.r - behind.r) * amount, 2)
      expect(got.g).toBeCloseTo(behind.g + (colour.g - behind.g) * amount, 2)
      expect(got.b).toBeCloseTo(behind.b + (colour.b - behind.b) * amount, 2)
    }
  })

  test("the same tint is made once, and the theme's colours are never changed", () => {
    const t = theme()
    const before = [t.backgroundPanel.r, t.info.r]
    expect(fillColour(t, "chip")).toBe(fillColour(t, "chip") as RGBA)
    expect([t.backgroundPanel.r, t.info.r]).toEqual(before)
  })

  test("on a theme with no dialog colour to tint, a chip has no fill — the word keeps its tone", () => {
    expect(fillColour(theme({ backgroundPanel: clear, background: clear }), "chip")).toBeUndefined()
  })
})
