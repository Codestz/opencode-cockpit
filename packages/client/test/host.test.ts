import { describe, expect, test } from "bun:test"
import { dualTui, fromV2, layerToV2, themeFromV2, type V2Context } from "../src/host.ts"

/**
 * The v2 half of the host, against a fake context shaped like OpenCode 2.0.15's (docs/opencode/v2.md).
 * What is checked is the translation — v1 names in, v2 calls out — since that is the part a real
 * OpenCode cannot show going wrong until someone's key does nothing.
 */

const colour = (name: string) => ({ name }) as never
const theme = {
  text: {
    base: colour("text"),
    muted: colour("muted"),
    action: { primary: colour("primary"), secondary: colour("secondary") },
    feedback: {
      error: colour("error"),
      warning: colour("warning"),
      success: colour("success"),
      info: colour("info"),
    },
  },
  background: {
    base: colour("bg"),
    raised: { base: colour("panel"), high: colour("element"), max: colour("max") },
  },
  border: { base: colour("border") },
  diff: {
    text: {
      added: colour("added"),
      removed: colour("removed"),
      context: colour("context"),
      hunkHeader: colour("hunk"),
    },
    background: { added: colour("addedBg"), removed: colour("removedBg"), context: colour("contextBg") },
    highlight: { added: colour("addedHi"), removed: colour("removedHi") },
    lineNumber: { text: colour("lineNumber"), background: colour("lineNumberBg") },
  },
  syntax: { keyword: colour("keyword"), punctuation: colour("punct") },
  markdown: { heading: colour("heading") },
}

function fakeContext() {
  const calls: { slot: unknown[]; toast: unknown[]; stored: Record<string, unknown> } = {
    slot: [],
    toast: [],
    stored: {},
  }
  const store = { values: {} as Record<string, unknown> }
  const ctx = {
    options: { dockHeight: 12 },
    location: { directory: "/work/project" },
    renderer: {},
    client: {},
    theme,
    data: {
      location: {
        default: () => ({ directory: "/work/project" }),
        vcs: {
          sync: async () => {},
          info: () => ({ branch: { current: "feat/x", default: "main" } }),
        },
      },
      session: {},
    },
    keymap: {
      layer: () => {},
      shortcuts: (id: string) => (id === "cockpit.shells.dock" ? ["ctrl+x o"] : []),
    },
    storage: {
      store: () =>
        [
          store,
          async (mutation: (draft: typeof store) => void) => {
            mutation(store)
            Object.assign(calls.stored, store.values)
          },
        ] as const,
    },
    ui: {
      dialog: {},
      toast: { show: (options: unknown) => calls.toast.push(options) },
      router: { current: () => ({ type: "session", sessionID: "ses_1" }) },
      slot: (claim: unknown) => {
        calls.slot.push(claim)
        return () => {}
      },
    },
  } as unknown as V2Context
  return { ctx, calls }
}

describe("a v1 key layer, as v2 reads one", () => {
  test("commands keep their names, slash names and palette, and bindings become `bind`", () => {
    const layer = layerToV2({
      priority: 100,
      commands: [
        {
          name: "cockpit.shells.dock",
          title: "Toggle shells",
          category: "Shells",
          namespace: "palette",
          slashName: "shells-dock",
          run: () => {},
        },
        { name: "cockpit.console.down", title: "Scroll down", run: () => {} },
      ],
      bindings: [
        { key: "j,down", cmd: "cockpit.console.down" },
        { key: "<leader>o", cmd: "cockpit.shells.dock" },
      ],
    } as never)
    expect(layer.priority).toBe(100)
    expect(layer.mode).toBe("global")
    const [dock, down] = layer.commands ?? []
    expect(dock).toMatchObject({
      id: "cockpit.shells.dock",
      group: "Shells",
      palette: true,
      slash: { name: "shells-dock" },
      bind: "<leader>o",
    })
    expect(down).toMatchObject({ id: "cockpit.console.down", bind: "j,down" })
    expect(layer.bindings).toEqual(["cockpit.shells.dock", "cockpit.console.down"])
  })

  test("a command with no key is still reachable by slash or palette, and binds nothing", () => {
    const layer = layerToV2({
      commands: [{ name: "cockpit.shells.pick", slashName: "shells", run: () => {} }],
    } as never)
    expect(layer.commands?.[0]?.bind).toBe(false)
  })
})

describe("v2's token theme under v1's names", () => {
  const current = themeFromV2(() => theme as never) as unknown as Record<string, { name: string }>
  test("maps each name a bay reads", () => {
    expect(current.text?.name).toBe("text")
    expect(current.textMuted?.name).toBe("muted")
    expect(current.accent?.name).toBe("primary")
    expect(current.backgroundPanel?.name).toBe("panel")
    expect(current.backgroundElement?.name).toBe("element")
    expect(current.diffAddedBg?.name).toBe("addedBg")
    expect(current.syntaxPunctuation?.name).toBe("punct")
    expect(current.markdownHeading?.name).toBe("heading")
  })
  test("a name v2 has no token for falls back to the text colour rather than nothing", () => {
    expect(current.somethingNew?.name).toBe("text")
  })
})

describe("the v2 host", () => {
  test("reads the location, branch and route v1 bays expect", () => {
    const { ctx } = fakeContext()
    const host = fromV2(ctx, () => {})
    expect(host.version).toBe(2)
    expect(host.state.path).toEqual({ directory: "/work/project", worktree: "/work/project" })
    expect(host.state.vcs).toEqual({ branch: "feat/x", default_branch: "main" })
    expect(host.route.current).toEqual({ name: "session", params: { sessionID: "ses_1" } })
    expect(host.keymap.shortcut("cockpit.shells.dock")).toBe("ctrl+x o")
  })

  test("keeps kv in plugin storage", () => {
    const { ctx, calls } = fakeContext()
    const host = fromV2(ctx, () => {})
    expect(host.kv.get("cockpit.dock.open", false)).toBe(false)
    host.kv.set("cockpit.dock.open", true)
    expect(calls.stored["cockpit.dock.open"]).toBe(true)
    expect(host.kv.get("cockpit.dock.open", false)).toBe(true)
  })

  test("puts v1 slots in v2's places, and cleans them up", () => {
    const { ctx, calls } = fakeContext()
    const cleanups: unknown[] = []
    const host = fromV2(ctx, (fn) => cleanups.push(fn))
    host.slots.register({ slots: { app_bottom: () => null as never, sidebar_content: () => null as never } })
    expect(calls.slot.map((claim) => (claim as { append: string }).append)).toEqual([
      "app",
      "sidebar.content",
    ])
    expect(cleanups).toHaveLength(2)
  })
})

describe("one entry for both", () => {
  test("carries v1's tui and v2's setup, and setup hands back a cleanup that runs every dispose", async () => {
    let started: number | undefined
    const disposed: string[] = []
    const entry = dualTui("cockpit.test", (host) => {
      started = host.version
      host.lifecycle.onDispose(() => disposed.push("a"))
      host.lifecycle.onDispose(() => disposed.push("b"))
    })
    expect(entry.id).toBe("cockpit.test")
    expect(typeof entry.tui).toBe("function")
    const cleanup = await entry.setup(fakeContext().ctx)
    expect(started).toBe(2)
    cleanup()
    expect(disposed).toEqual(["b", "a"])
  })
})
