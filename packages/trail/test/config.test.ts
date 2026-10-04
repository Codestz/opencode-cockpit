import { describe, expect, test } from "bun:test"
import { loadTrail } from "../src/core/config.ts"

/** Settings files as text on a pretend disk: the loader every bay shares, Trail's section of it. */
const at = (files: Record<string, string>) => ({
  env: { XDG_CONFIG_HOME: "/home/me/.config" },
  read: (path: string) => files[path],
})
const GLOBAL = "/home/me/.config/opencode-cockpit/config.json"
const PROJECT = "/work/app/.cockpit.json"

describe("Trail's settings", () => {
  test("nothing written: on, in the sidebar, five rows, after Shells", () => {
    const { settings, order, notices } = loadTrail("/work/app", undefined, at({}))
    expect(settings).toEqual({
      enabled: true,
      sidebar: true,
      sidebarRows: 5,
      hideWhenEmpty: false,
      keybinds: {},
    })
    /** status, subagents, shell, trail: the fourth place. */
    expect(order).toBe(140)
    expect(notices).toEqual([])
  })

  test("the shared keys, from a file with comments, the project over the global one", () => {
    const { settings } = loadTrail(
      "/work/app",
      undefined,
      at({
        [GLOBAL]: '{\n  // mine\n  "trail": { "sidebarRows": 8, "hideWhenEmpty": true, },\n}',
        [PROJECT]: '{ "trail": { "sidebar": false, "keybinds": { "cockpit.trail.open": "<leader>j" } } }',
      }),
    )
    expect(settings).toEqual({
      enabled: true,
      sidebar: false,
      sidebarRows: 8,
      hideWhenEmpty: true,
      keybinds: { "cockpit.trail.open": "<leader>j" },
    })
  })

  test("the top-level list moves the block; a wrong kind is a notice and the default", () => {
    const loaded = loadTrail(
      "/work/app",
      undefined,
      at({ [GLOBAL]: '{ "sidebar": ["trail", "status"], "trail": { "sidebarRows": "lots" } }' }),
    )
    expect(loaded.order).toBe(110)
    expect(loaded.settings.sidebarRows).toBe(5)
    expect(loaded.notices).toEqual(['settings: "trail.sidebarRows" should be a number; the default is used'])
  })

  test("off: `enabled: false` in plugin options, or `features.trail: false` in a file", () => {
    expect(loadTrail("/work/app", { enabled: false }, at({})).settings.enabled).toBe(false)
    expect(
      loadTrail("/work/app", undefined, at({ [PROJECT]: '{ "features": { "trail": false } }' })).settings
        .enabled,
    ).toBe(false)
  })
})
