import { describe, expect, test } from "bun:test"
import { dualTui, fromV1, fromV2, layerToV2, themeFromV2, type V2Context } from "../src/host.ts"

/**
 * The v2 half of the host, against a fake context shaped like OpenCode 2.0.15's (docs/opencode/v2.md).
 * What is checked is the translation — v1 names in, v2 calls out — since that is the part a real
 * OpenCode cannot show going wrong until someone's key does nothing.
 */

/** Colours carry a `buffer`, as OpenTUI's do; the name is only there to tell them apart. */
const colour = (name: string) => ({ name, buffer: [] }) as never
/** Action and feedback tokens are a colour per state in OpenCode 2.0.15 — measured, not assumed. */
const states = (name: string) => ({ base: colour(name), hovered: colour(`${name}:hovered`) })
const theme = {
  text: {
    base: colour("text"),
    muted: colour("muted"),
    action: { primary: states("primary"), secondary: states("secondary") },
    feedback: {
      error: states("error"),
      warning: states("warning"),
      success: { base: colour("success"), muted: colour("success:muted") },
      info: states("info"),
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
    /** No palettes in this theme, so the accent falls back to the token built from it. */
    expect(current.accent?.name).toBe("keyword")
    expect(current.backgroundPanel?.name).toBe("panel")
    expect(current.backgroundElement?.name).toBe("element")
    expect(current.diffAddedBg?.name).toBe("addedBg")
    expect(current.syntaxPunctuation?.name).toBe("punct")
    expect(current.markdownHeading?.name).toBe("heading")
  })
  /** Handing a bay the whole group made Review's paint throw on every frame. */
  test("a token with a colour per state reads as its colour at rest", () => {
    expect(current.primary?.name).toBe("primary")
    expect(current.error?.name).toBe("error")
    expect(current.success?.name).toBe("success")
    expect("buffer" in (current.warning as object)).toBe(true)
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
    /** The first claim is the host's own: an invisible `app` render that owns the key layers. */
    expect(calls.slot.map((claim) => (claim as { append: string }).append)).toEqual([
      "app",
      "app",
      "sidebar.content",
    ])
    expect(cleanups).toHaveLength(3)
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

/** The handler a fake dialog was given, or a failure that says which one never opened. */
function handler(
  seen: Record<string, Record<string, (...args: never[]) => void>>,
  dialog: string,
  name: string,
): (...args: unknown[]) => void {
  const found = seen[dialog]?.[name]
  if (!found) throw new Error(`the ${dialog} dialog never opened with ${name}`)
  return found as (...args: unknown[]) => void
}

describe("the v1 host's dialogs", () => {
  /**
   * v1's dialog calls its close handler when cleared. Clearing before answering settled every prompt
   * as cancelled — the new-shell prompt took a command and started nothing.
   */
  function fakeV1() {
    let onClose: (() => void) | undefined
    const seen: Record<string, Record<string, (...args: never[]) => void>> = {}
    const component = (name: string) => (props: Record<string, (...args: never[]) => void>) => {
      seen[name] = props
      return null
    }
    const api = {
      ui: {
        dialog: {
          replace: (render: () => unknown, close?: () => void) => {
            onClose = close
            render()
          },
          clear: () => onClose?.(),
        },
        DialogPrompt: component("prompt"),
        DialogConfirm: component("confirm"),
        DialogSelect: component("select"),
      },
    }
    return { host: fromV1(api as never), seen }
  }

  test("a prompt answers with what was typed", async () => {
    const { host, seen } = fakeV1()
    const answer = host.ui.prompt({ title: "New background shell" })
    handler(seen, "prompt", "onConfirm")("npm run dev")
    expect(await answer).toBe("npm run dev")
  })

  test("a confirmation answers yes, and a list answers with the choice", async () => {
    const { host, seen } = fakeV1()
    const yes = host.ui.confirm({ title: "Stop?", message: "3 running" })
    handler(seen, "confirm", "onConfirm")()
    expect(await yes).toBe(true)
    const choice = host.ui.select({ title: "Shells", options: [{ title: "a", value: "sh_a" }] })
    handler(seen, "select", "onSelect")({ value: "sh_a" })
    expect(await choice).toBe("sh_a")
  })

  test("closing without answering is a cancel", async () => {
    const { host, seen } = fakeV1()
    const answer = host.ui.prompt({ title: "Name" })
    handler(seen, "prompt", "onCancel")()
    expect(await answer).toBeUndefined()
  })
})

/**
 * The mapping against the real thing: OpenCode 2.0.15's default theme and v1 1.18.32's, as each
 * version handed them to a plugin (captured by a probe plugin; see docs/opencode/v2.md). The first
 * mapping was written from v2's docs and put a white where every accent should be — right shape,
 * wrong colour, and no test could tell. This one compares colours.
 */
describe("v2's default theme, read under v1's names, is v1's default theme", async () => {
  type Node = { hex?: string; hue?: string; step?: number } & Record<string, unknown>
  const v1 = (await Bun.file(`${import.meta.dir}/fixtures/v1-default-theme.json`).json()) as Record<
    string,
    string
  >
  const raw = (await Bun.file(`${import.meta.dir}/fixtures/v2-default-theme.json`).json()) as Node

  /** Colours as OpenTUI's: a `buffer`, and a source the theme can be asked for. */
  const sources = new Map<object, { hue: string; step: number }>()
  const build = (node: Node): unknown => {
    if (typeof node.hex === "string") {
      const h = node.hex
      const colour = {
        buffer: [1, 3, 5, 7].map((i) => Number.parseInt(h.slice(i, i + 2), 16)),
        hex: h.slice(0, 7),
      }
      if (node.hue && node.step !== undefined) sources.set(colour, { hue: node.hue, step: node.step })
      return colour
    }
    return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, build(value as Node)]))
  }
  const live = { ...(build(raw) as object), source: (colour: object) => sources.get(colour) }
  const current = themeFromV2(() => live as never) as unknown as Record<string, { hex: string }>

  /** No v2 token has v1's subtle-border grey; the nearest border stands in, a shade lighter. */
  const nearest = new Set(["borderSubtle"])

  for (const [name, hex] of Object.entries(v1)) {
    if (nearest.has(name)) continue
    test(name, () => expect(current[name]?.hex).toBe(hex))
  }
})
