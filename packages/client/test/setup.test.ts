import { describe, expect, test } from "bun:test"
import { claimedFeatures, claimFeature } from "../src/feature.ts"
import type { Host } from "../src/host.ts"
import { baySettings, baysRead, SHARED_DEFAULTS, SIDEBAR_BAYS } from "../src/settings.ts"
import {
  briefAgent,
  buildSetupReport,
  HOST_BLOCKS,
  type ReportInput,
  readHostFile,
  registerSetup,
  setupBrief,
} from "../src/setup.ts"

/**
 * `/cockpit-setup` sends this to the agent. What is tested is its structure and the facts in it —
 * which bays, which files, which names to fix, which defaults — not its prose.
 */

const GLOBAL = "/home/me/.config/opencode-cockpit/config.json"
const PROJECT = "/work/app/.cockpit.json"

const bundle = (bays: string[]) => new Map(bays.map((bay) => [bay, "opencode-cockpit"]))

function brief(files: Record<string, unknown>, over: Partial<ReportInput> = {}) {
  const report = buildSetupReport({
    opencode: 2,
    directory: "/work/app",
    claims: bundle(["status", "subagents", "shell", "trail", "review", "updater", "trust"]),
    env: {},
    home: "/home/me",
    read: (path) => {
      const file = files[path]
      return file === undefined ? undefined : typeof file === "string" ? file : JSON.stringify(file)
    },
    ...over,
  })
  return { report, text: setupBrief(report) }
}

const headings = (text: string) => text.split("\n").filter((line) => line.startsWith("## "))

describe("the brief's shape", () => {
  test("its sections, in order, with nothing to fix", () => {
    expect(headings(brief({}).text)).toEqual([
      "## Where it stands",
      "## The settings",
      "## OpenCode's own sidebar blocks",
      "## Ask me first, one question at a time",
      "## Then",
    ])
  })

  test("old names get a section of their own, first after where it stands", () => {
    const { text } = brief({ [PROJECT]: { statusline: { preset: "minimal" }, sidebar: ["shells"] } })
    expect(headings(text).slice(0, 4)).toEqual([
      "## Where it stands",
      "## Fix these first",
      "## Also not read",
      "## The settings",
    ])
  })

  test("it ends by asking before anything is edited", () => {
    expect(brief({}).text.trimEnd().endsWith("Ask me what I want before you edit anything.")).toBe(true)
  })

  test("the questions are numbered without gaps, whichever bays are loaded", () => {
    const { text } = brief({}, { claims: bundle(["shell"]) })
    const numbers = text.match(/^\d+\. /gm)?.map((n) => Number.parseInt(n, 10))
    expect(numbers).toEqual(numbers?.map((_, at) => at + 1))
    expect(text).not.toContain("trust.sidebar")
    expect(text).not.toContain("(`status.sidebar`)")
  })
})

describe("where it stands", () => {
  test("names the bays this window loaded and where from, and the ones it did not", () => {
    const { text } = brief(
      {},
      {
        claims: new Map([
          ["shell", "@opencode-cockpit/shell"],
          ["setup", "x"],
        ]),
      },
    )
    expect(text).toContain("Loaded in this window (from @opencode-cockpit/shell):")
    expect(text).toContain("  - `shell`:")
    expect(text).toMatch(/Not installed: status, subagents, trail, trust, review, updater\./)
    expect(text).not.toContain("`setup`")
  })

  test("both files, and whether each exists", () => {
    const { text } = brief({ [PROJECT]: "{}" })
    expect(text).toContain(`  - global: \`${GLOBAL}\` (does not exist yet)`)
    expect(text).toContain(`  - project: \`${PROJECT}\` (exists)`)
  })

  test("a file that will not parse says so", () => {
    expect(brief({ [GLOBAL]: "{ nope" }).text).toMatch(
      /global: .* \(unreadable: .*; the whole file is ignored/,
    )
  })

  test("what is written, merged, as JSON — or that nothing is", () => {
    expect(brief({}).text).toContain("Nothing is written in either file")
    const { text } = brief({
      [GLOBAL]: { shell: { dockHeight: 20 } },
      [PROJECT]: { shell: { colors: false } },
    })
    expect(text).toContain('"dockHeight": 20')
    expect(text).toContain('"colors": false')
  })
})

describe("what to fix", () => {
  test("every old name, with the name to write instead", () => {
    const { text } = brief({ [PROJECT]: { statusline: {}, subagents: { hideNestedAfter: 5 } } })
    expect(text).toContain("`statusline` is no longer read. Write it as `status`.")
    expect(text).toContain(
      "`subagents.hideNestedAfter` is no longer read. Write it as `subagents.hideNestedAfterSeconds`.",
    )
    expect(text).toContain('fix every old name under "Fix these first"')
  })

  test("a bay's old number for its place points at the list, not at a new name to copy it to", () => {
    expect(brief({ [PROJECT]: { shell: { sidebarOrder: 170 } } }).text).toContain(
      "`shell.sidebarOrder` is no longer read. Remove it; the order is the top-level `sidebar` list.",
    )
  })

  test("notices from a bay's plugin options are in it too", () => {
    baySettings("review", {}, { options: { sidebarOrder: 3 }, settings: brief({}).report.settings })
    const { text } = brief({}, { bays: baysRead() })
    expect(text).toContain("`plugin options`: `sidebarOrder` is no longer read.")
  })
})

describe("the settings, from the loader's own defaults", () => {
  test("every sidebar bay's block defaults, from SHARED_DEFAULTS", () => {
    const { text } = brief({})
    for (const bay of SIDEBAR_BAYS) {
      const d = SHARED_DEFAULTS[bay]
      expect(text).toContain(`| ${bay} | ${d.sidebar} | ${d.sidebarRows} | ${d.hideWhenEmpty} |`)
    }
  })

  test("a loaded bay's own keys come from the defaults it handed baySettings", () => {
    baySettings(
      "shell",
      { dockHeight: 14, defaultView: "screen", watch: {} },
      { settings: brief({}).report.settings },
    )
    const { text } = brief({}, { bays: baysRead() })
    expect(text).toMatch(/- `shell`: .*`dockHeight` 14, `defaultView` "screen", `watch` unset/)
  })

  test("a bay that is not loaded has no own-keys line", () => {
    baySettings("trust", { threshold: 3 }, { settings: brief({}).report.settings })
    expect(brief({}, { claims: bundle(["shell"]), bays: baysRead() }).text).not.toContain("- `trust`:")
  })
})

describe("OpenCode's own blocks", () => {
  const V1 = "/home/me/.config/opencode/tui.json"
  const V2 = "/home/me/.config/opencode/cli.json"

  test("reads the switches each version writes", () => {
    expect(
      readHostFile(
        1,
        V1,
        JSON.stringify({ plugin_enabled: { "internal:sidebar-todo": false, other: false } }),
      ).blocks,
    ).toEqual({ "internal:sidebar-todo": false })
    expect(readHostFile(2, V2, '{ "plugins": ["x", "-opencode.sidebar.context"] }').blocks).toEqual({
      "opencode.sidebar.context": false,
    })
    expect(readHostFile(2, V2, "{ nope").error).toBeTruthy()
  })

  test("suggests turning Context off when Status draws in the sidebar, in each version's syntax", () => {
    expect(brief({}, { opencode: 1 }).text).toContain(
      `\`"plugin_enabled": { "${HOST_BLOCKS[1].context}": false }\``,
    )
    expect(brief({}).text).toContain(`add \`"-${HOST_BLOCKS[2].context}"\` to the \`"plugins"\` list`)
  })

  test("no suggestion once it is off, or when Status is at the bottom", () => {
    const off = brief({ [V2]: { plugins: ["-opencode.sidebar.context"] } }).text
    expect(off).toContain(`Context (\`opencode.sidebar.context\`): off (set in \`${V2}\`)`)
    expect(off).not.toContain("Suggest turning it off")
    expect(brief({ [PROJECT]: { status: { sidebar: false } } }).text).not.toContain("Suggest turning it off")
  })

  test("Todo is never offered off; when it is off, turning it back on is offered", () => {
    const on = brief({}, { opencode: 1 }).text
    expect(on).toContain("Never suggest turning it off")
    const off = brief({ [V1]: { plugin_enabled: { "internal:sidebar-todo": false } } }, { opencode: 1 }).text
    expect(off).toContain("offer to turn it back on")
    expect(off).toContain('`"plugin_enabled": { "internal:sidebar-todo": true }`')
  })

  test("OpenCode 2 has no LSP or Todo block to talk about", () => {
    const { text } = brief({})
    expect(text).not.toContain("internal:sidebar-lsp")
    expect(text).toContain("OpenCode 2 draws no LSP or Todo block")
  })
})

/* ─── the command ───────────────────────────────────────────────────────────────────────────── */

interface Fake {
  host: Host
  layers: unknown[]
  toasts: string[]
  calls: string[]
}

function fakeHost(over: { version?: 1 | 2; route?: Host["route"]["current"]; status?: string } = {}): Fake {
  const layers: unknown[] = []
  const toasts: string[] = []
  const calls: string[] = []
  const host = {
    version: over.version ?? 2,
    renderer: {},
    state: { path: { directory: "/work/app", worktree: "/work/app" } },
    route: { current: over.route ?? { name: "home" } },
    ui: { toast: (toast: { message: string }) => toasts.push(toast.message) },
    keymap: {
      registerLayer: (layer: unknown) => {
        layers.push(layer)
        return () => {}
      },
    },
    lifecycle: { onDispose: () => {} },
    log: { info: () => {}, warn: () => {} },
    ...(over.version === 1
      ? {
          v1: {
            client: {
              tui: {
                appendPrompt: async ({ text }: { text: string }) =>
                  void calls.push(`append ${text.length > 0}`),
                submitPrompt: async () => void calls.push("submit"),
              },
            },
          },
        }
      : {
          v2: {
            ui: {
              router: {
                navigate: (route: { sessionID: string }) => calls.push(`navigate ${route.sessionID}`),
              },
            },
            data: {
              session: {
                status: () => over.status ?? "idle",
                create: () => {
                  calls.push("create")
                  return { id: "ses_new", request: Promise.resolve() }
                },
                prompt: async (input: { sessionID: string; delivery?: string }) =>
                  void calls.push(`prompt ${input.sessionID} ${input.delivery ?? "default"}`),
              },
            },
          },
        }),
  } as unknown as Host
  return { host, layers, toasts, calls }
}

const settle = () => new Promise((done) => setTimeout(done, 5))

describe("registerSetup", () => {
  test("the first entry in a window registers the command; the rest do not", () => {
    const a = fakeHost()
    registerSetup(a.host, "opencode-cockpit")
    registerSetup({ ...a.host } as Host, "@opencode-cockpit/shell")
    expect(a.layers).toHaveLength(1)
    const command = (
      a.layers[0] as { commands: { slashName: string; category: string; namespace: string }[] }
    ).commands[0]
    expect(command).toMatchObject({ slashName: "cockpit-setup", category: "Cockpit", namespace: "palette" })
  })

  test("the bays it lists are the window's claims, read when it runs", () => {
    const { host } = fakeHost()
    claimFeature(host.renderer, "shell", "@opencode-cockpit/shell")
    expect([...claimedFeatures(host.renderer).keys()]).toEqual(["shell"])
  })
})

describe("briefAgent, from every state", () => {
  test("OpenCode 2 at home: a conversation is made, opened, and briefed", async () => {
    const fake = fakeHost()
    briefAgent(fake.host, "brief", "Cockpit setup")
    await settle()
    expect(fake.calls).toEqual(["create", "navigate ses_new", "prompt ses_new default"])
    expect(fake.toasts).toEqual(["Briefed the agent."])
  })

  test("OpenCode 2, agent busy: queued behind the running turn, not steered into it", async () => {
    const fake = fakeHost({ route: { name: "session", params: { sessionID: "ses_1" } }, status: "running" })
    briefAgent(fake.host, "brief", "Cockpit setup")
    await settle()
    expect(fake.calls).toEqual(["prompt ses_1 queue"])
  })

  test("OpenCode 1: into the prompt and submitted, which starts or queues a turn itself", async () => {
    const fake = fakeHost({ version: 1 })
    briefAgent(fake.host, "brief", "Cockpit setup")
    await settle()
    expect(fake.calls).toEqual(["append true", "submit"])
    expect(fake.toasts).toEqual(["Briefed the agent."])
  })
})
