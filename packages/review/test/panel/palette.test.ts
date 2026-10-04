import { describe, expect, test } from "bun:test"
import { matchesBinding, paletteBindings } from "../../src/core/palette.ts"

/** The review steps aside for the host's palette: it has to recognise the palette's key exactly. */
describe("the palette's key", () => {
  test("ctrl+p unless the config says otherwise", () => {
    expect(paletteBindings(undefined)).toEqual(["ctrl+p"])
    expect(paletteBindings({ keybinds: {} })).toEqual(["ctrl+p"])
    expect(paletteBindings({ keybinds: { command_list: "ctrl+k, F2" } })).toEqual(["ctrl+k", "f2"])
    expect(paletteBindings({ keybinds: { command_list: "none" } })).toEqual([])
  })

  test("leader chords are left to the host", () => {
    expect(paletteBindings({ keybinds: { command_list: "<leader>p,ctrl+p" } })).toEqual(["ctrl+p"])
  })

  test("every modifier exactly", () => {
    expect(matchesBinding({ name: "p", ctrl: true }, "ctrl+p")).toBe(true)
    expect(matchesBinding({ name: "p" }, "ctrl+p")).toBe(false)
    expect(matchesBinding({ name: "p", ctrl: true, shift: true }, "ctrl+p")).toBe(false)
    expect(matchesBinding({ name: "k", ctrl: true, shift: true }, "ctrl+shift+k")).toBe(true)
    expect(matchesBinding({ name: "f2" }, "f2")).toBe(true)
    expect(matchesBinding({ name: "p", meta: true }, "alt+p")).toBe(true)
  })
})
