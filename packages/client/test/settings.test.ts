import { describe, expect, test } from "bun:test"
import {
  baySettings,
  closestName,
  loadSettings,
  OLD_NAMES,
  orderOf,
  type SettingsWhere,
} from "../src/settings/index.ts"

/**
 * One loader for every bay: the files mean the same thing to all of them, a comment never drops a
 * file, an old name says it is not read, and nothing a user writes can throw.
 */

const GLOBAL = "/home/me/.config/opencode-cockpit/config.json"
const PROJECT = "/work/project/.cockpit.json"

function where(files: Record<string, string | object>): SettingsWhere {
  return {
    directory: "/work/project",
    env: {},
    home: "/home/me",
    read: (path) => {
      const file = files[path]
      return file === undefined ? undefined : typeof file === "string" ? file : JSON.stringify(file)
    },
  }
}

describe("reading the files", () => {
  test("comments and trailing commas are fine", () => {
    const settings = loadSettings(
      where({
        [GLOBAL]: `{
          // mine
          "trust": { "threshold": 5, /* five */ },
          "sidebar": ["shell", "status",],
        }`,
      }),
    )
    expect(settings.notices).toEqual([])
    expect(settings.sections.trust).toEqual({ threshold: 5 })
    expect(settings.sidebarList).toEqual(["shell", "status"])
  })

  test("global, then project, then plugin options; nested objects merge key by key", () => {
    const loaded = baySettings(
      "shell",
      { dockHeight: 14, lifecycle: { onExit: "stopMine", orphanAfterMinutes: 60 } },
      {
        where: where({
          [GLOBAL]: { shell: { dockHeight: 16, sidebarRows: 9, lifecycle: { onExit: "keep" } } },
          [PROJECT]: { shell: { dockHeight: 20, keybinds: { "cockpit.shells.dock": "<leader>d" } } },
        }),
        options: { sidebarRows: 2 },
      },
    )
    expect(loaded.config).toMatchObject({
      dockHeight: 20,
      sidebarRows: 2,
      enabled: true,
      sidebar: true,
      hideWhenEmpty: false,
      keybinds: { "cockpit.shells.dock": "<leader>d" },
      lifecycle: { onExit: "keep", orphanAfterMinutes: 60 },
    })
  })

  test("plugin options may be a whole config with a section for the bay", () => {
    const loaded = baySettings("trust", {}, { where: where({}), options: { trust: { sidebarRows: 7 } } })
    expect(loaded.config.sidebarRows).toBe(7)
  })

  test("a file that cannot be read is a notice, and costs nothing else", () => {
    const settings = loadSettings(where({ [GLOBAL]: "{ nope", [PROJECT]: { trust: { threshold: 4 } } }))
    expect(settings.files.find((file) => file.path === GLOBAL)?.error).toBeDefined()
    expect(settings.notices).toEqual([
      expect.objectContaining({ bay: "cockpit", file: GLOBAL, kind: "unreadable" }),
    ])
    expect(settings.sections.trust).toEqual({ threshold: 4 })
    expect(() => loadSettings(where({ [GLOBAL]: "[1, 2]", [PROJECT]: "null" }))).not.toThrow()
  })

  test("a value of the wrong kind falls back to the default, and says where it was", () => {
    const loaded = baySettings(
      "shell",
      { dockHeight: 14 },
      { where: where({ [GLOBAL]: { shell: { dockHeight: "16", sidebarRows: "8", hideWhenEmpty: 1 } } }) },
    )
    expect(loaded.config.dockHeight).toBe(14)
    expect(loaded.config.sidebarRows).toBe(5)
    expect(loaded.config.hideWhenEmpty).toBe(false)
    expect(loaded.notices.map((notice) => notice.text)).toEqual([
      '"shell.sidebarRows" should be a number; the default is used',
      '"shell.hideWhenEmpty" should be a boolean; the default is used',
      '"shell.dockHeight" should be a number; the default is used',
    ])
    expect(loaded.notices.every((notice) => notice.file === GLOBAL)).toBe(true)
  })

  test("the shared defaults: every block present, Trust's opt-in, nothing hidden when empty", () => {
    const none = where({})
    expect(baySettings("subagents", {}, { where: none }).config).toEqual({
      enabled: true,
      keybinds: {},
      sidebar: true,
      sidebarRows: 6,
      hideWhenEmpty: false,
    })
    expect(baySettings("trail", {}, { where: none }).config.sidebar).toBe(true)
    expect(baySettings("trust", {}, { where: none }).config.sidebar).toBe(false)
  })

  test("features.<bay>: false in a file turns the bay off", () => {
    const loaded = baySettings("review", {}, { where: where({ [GLOBAL]: { features: { review: false } } }) })
    expect(loaded.config.enabled).toBe(false)
  })

  test("a file's root is no bay's settings: Status reads nothing without its section", () => {
    const loaded = baySettings(
      "status",
      { debug: false },
      { where: where({ [GLOBAL]: { enabled: false, debug: true } }) },
    )
    expect(loaded.config.enabled).toBe(true)
    expect(loaded.config.debug).toBe(false)
    expect(loaded.notices.map((notice) => notice.text)).toEqual([
      '"enabled" at the top level is not read: it belongs in "status"',
      '"debug" at the top level is not read: it belongs in "status"',
    ])
  })
})

describe("old names", () => {
  /** Detection only: the value under an old name is ignored, the default applies, and it says so. */
  test("each one is a notice, its value ignored and the default used", () => {
    const loaded = (bay: Parameters<typeof baySettings>[0], file: object, defaults = {}) =>
      baySettings(bay, defaults, { where: where({ [GLOBAL]: file }) })

    const status = loaded("status", { statusline: { maxRows: 3, debug: true } }, { debug: false })
    expect(status.config.debug).toBe(false)
    expect(status.notices).toEqual([
      {
        bay: "status",
        file: GLOBAL,
        kind: "old",
        old: "statusline",
        new: "status",
        text: '"statusline" is no longer read — run /cockpit-setup',
      },
    ])

    const shell = loaded(
      "shell",
      { watch: { auto: true }, ui: { dockHeight: 30, sidebarOrder: 1 } },
      { dockHeight: 14 },
    )
    expect(shell.config.dockHeight).toBe(14)
    expect(shell.config).not.toHaveProperty("watch")
    expect(shell.notices.map((notice) => [notice.old, notice.new])).toEqual([
      ["watch", "shell.watch"],
      ["ui.dockHeight", "shell.dockHeight"],
      ["ui.sidebarOrder", "sidebar"],
    ])

    const subagents = loaded("subagents", {
      subagents: { hideFinishedAfter: 5, hideNestedAfter: 10, sidebarOrder: 3 },
    })
    expect(subagents.config).not.toHaveProperty("hideFinishedAfterMinutes")
    expect(subagents.notices.map((notice) => notice.new)).toEqual([
      "subagents.hideFinishedAfterMinutes",
      "subagents.hideNestedAfterSeconds",
      "sidebar",
    ])

    const maxRows = loaded("status", { status: { maxRows: 3 } })
    expect(maxRows.config.sidebarRows).toBe(8)
    expect(maxRows.notices[0]?.new).toBe("status.sidebarRows")

    const updater = loaded("updater", { ui: { updateCheck: false } })
    expect(updater.notices[0]).toMatchObject({ old: "ui.updateCheck", new: "updater.updateCheck" })
  })

  test("old names in plugin options too", () => {
    const loaded = baySettings("subagents", {}, { where: where({}), options: { hideFinishedAfter: 5 } })
    expect(loaded.notices).toEqual([
      expect.objectContaining({ file: "plugin options", old: "hideFinishedAfter", kind: "old" }),
    ])
    expect(loaded.written).toEqual({})
  })

  test("the list is there for /cockpit-setup's brief", () => {
    expect(OLD_NAMES).toContainEqual({ old: "statusline", new: "status" })
    expect(OLD_NAMES).toContainEqual({ old: "<bay>.sidebarOrder", new: "sidebar" })
  })
})

describe("the sidebar order", () => {
  test("default: status, subagents, shell, trail, trust — between Context (100) and MCP (200)", () => {
    const settings = loadSettings(where({}))
    expect(settings.sidebar).toEqual(["status", "subagents", "shell", "trail", "trust"])
    const orders = settings.sidebar.map((bay) => orderOf(settings, bay))
    expect(orders).toEqual([110, 120, 130, 140, 150])
  })

  test("the list is the only order; a bay it leaves out follows, in default order", () => {
    const settings = loadSettings(where({ [GLOBAL]: { sidebar: ["trust", "shell"] } }))
    expect(settings.sidebar).toEqual(["trust", "shell", "status", "subagents", "trail"])
  })

  test("a bay's old sidebarOrder no longer moves it", () => {
    const loaded = baySettings("trust", {}, { where: where({ [GLOBAL]: { trust: { sidebarOrder: 1 } } }) })
    expect(loaded.order).toBe(150)
    expect(loaded.notices[0]).toMatchObject({ old: "trust.sidebarOrder", new: "sidebar", kind: "old" })
  })

  test("a project's list replaces the global one", () => {
    const settings = loadSettings(
      where({ [GLOBAL]: { sidebar: ["shell", "status"] }, [PROJECT]: { sidebar: ["status"] } }),
    )
    expect(settings.sidebarList).toEqual(["status"])
  })

  test("an unknown entry names the closest bay, on that bay's block", () => {
    const settings = loadSettings(where({ [GLOBAL]: { sidebar: ["status", "shells", "review", "xyz"] } }))
    expect(settings.sidebarList).toEqual(["status"])
    expect(settings.notices.map((notice) => [notice.bay, notice.text])).toEqual([
      [
        "shell",
        '"shells" in "sidebar" is not a bay: did you mean "shell"? (status, subagents, shell, trail, trust)',
      ],
      ["review", '"review" in "sidebar" has no sidebar block (status, subagents, shell, trail, trust)'],
      ["cockpit", '"xyz" in "sidebar" is not a bay (status, subagents, shell, trail, trust)'],
    ])
  })

  test("closest names", () => {
    const bays = ["status", "subagents", "shell", "trail", "trust"]
    expect(closestName("shells", bays)).toBe("shell")
    expect(closestName("statusline", bays)).toBe("status")
    expect(closestName("Subagent", bays)).toBe("subagents")
    expect(closestName("trails", bays)).toBe("trail")
    expect(closestName("qqqqqq", bays)).toBeUndefined()
  })
})
