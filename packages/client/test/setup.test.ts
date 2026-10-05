import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { claimFeature } from "../src/feature.ts"
import { silentLog } from "../src/log.ts"
import type { Host } from "../src/opencode/host.ts"
import type { ServerHost } from "../src/opencode/server.ts"
import { sectionText, writeSection } from "../src/setup/conventions.ts"
import {
  baysOfEntry,
  briefAgent,
  CONVENTIONS_TOOL,
  conventionsReply,
  HOST_BLOCKS,
  offerPreview,
  previewCommands,
  type ReportInput,
  readHostFile,
  readInstalls,
  registerSetup,
  SETTINGS_TOOL,
  SETUP_PROMPT,
  SETUP_SKILL_DIR,
  settingsReport,
  settingsText,
  setupServer,
  tuneFacts,
  tuneText,
} from "../src/setup/index.ts"

/**
 * `cockpit_settings` is what the agent reads before and after it edits. What is tested is the facts
 * in it — which bays, which files, which values from where, what to fix — and that it says them in
 * the order an agent acts on them, not its prose.
 */

const GLOBAL = "/home/me/.config/opencode-cockpit/config.json"
const PROJECT = "/work/app/.cockpit.json"
const OPENCODE = "/home/me/.config/opencode/opencode.json"
const V1_TUI = "/home/me/.config/opencode/tui.json"
const V2_CLI = "/home/me/.config/opencode/cli.json"

/** The bundle installed, plus whatever files a test adds. */
function report(files: Record<string, unknown>, over: Partial<ReportInput> = {}) {
  const all: Record<string, unknown> = { [OPENCODE]: { plugins: ["opencode-cockpit@0.9.0"] }, ...files }
  const result = settingsReport({
    opencode: 2,
    directory: "/work/app",
    env: {},
    home: "/home/me",
    read: (path) => {
      const file = all[path]
      return file === undefined ? undefined : typeof file === "string" ? file : JSON.stringify(file)
    },
    ...over,
  })
  return { report: result, text: settingsText(result) }
}

const headings = (text: string) => text.split("\n").filter((line) => line.startsWith("## "))
const bay = (text: string, name: string) => {
  const lines = text.split("\n")
  const at = lines.findIndex((line) => line.startsWith(`### ${name} `))
  return at < 0 ? "" : lines.slice(at, lines.indexOf("", at)).join("\n")
}

describe("its shape", () => {
  test("nothing to fix: says so first, then files, bays, OpenCode's blocks, next", () => {
    const { text } = report({})
    expect(text.split("\n")[2]).toBe("Notices: none. Every setting written is read.")
    expect(headings(text).map((line) => line.split(" (")[0])).toEqual([
      "## Files",
      "## Bays",
      "## OpenCode's own sidebar blocks",
      "## Next",
    ])
  })

  test("with something to fix, that comes first", () => {
    const { text } = report({ [PROJECT]: { statusline: { preset: "minimal" } } })
    expect(headings(text)[0]).toBe("## Fix these first (1)")
    expect(text).toContain("- Fix the 1 notice above first.")
  })
})

describe("previews", () => {
  /** `bunx` fetches the newest release from npm; the agent is handed this install's own copy. */
  test("a bay's preview is listed by its exact command, and none means no section", () => {
    const { report: read, text: plain } = report({})
    expect(plain).not.toContain("## Previews")
    const text = settingsText(read, { status: 'bun "/x/status/dist/cli/preview.js"' })
    expect(text).toContain("## Previews")
    expect(text).toContain('- status: `bun "/x/status/dist/cli/preview.js"`')
    const order = headings(text).map((line) => line.split(" (")[0])
    expect(order.indexOf("## Previews")).toBe(order.indexOf("## Next") - 1)
  })

  test("offered previews are shared across copies of this module, by bay", () => {
    offerPreview("status", "bun /a/preview.js")
    offerPreview("status", "bun /b/preview.js")
    expect(previewCommands().status).toBe("bun /b/preview.js")
  })
})

describe("what to fix", () => {
  test("a name from before 0.9 is not a setting: the nearest one is offered", () => {
    const { text } = report({ [GLOBAL]: { statusline: {}, review: { sidebarOrder: 3 } } })
    expect(text).toContain(`- ${GLOBAL}: "statusline" is not a setting: did you mean "status"?`)
    expect(text).toContain(`- ${GLOBAL}: "review.sidebarOrder" is not a setting of review.`)
  })

  test("a key no bay reads is a notice too, with the one it most likely meant", () => {
    const { report: r, text } = report({ [PROJECT]: { shell: { hideWhenEmty: true } } })
    expect(r.notices).toHaveLength(1)
    expect(text).toContain(`"shell.hideWhenEmty" is not a setting of shell: did you mean "hideWhenEmpty"?`)
  })

  test("a starting point's keys raise none", () => {
    const { report: r } = report({
      [GLOBAL]: { subagents: { hideWhenEmpty: true, sidebarRows: 4 }, status: { sidebar: false } },
    })
    expect(r.notices).toEqual([])
  })
})

describe("files", () => {
  test("both, and whether each exists or parses", () => {
    const { text } = report({ [GLOBAL]: "{ nope" })
    expect(text).toContain(`- global: ${GLOBAL} — does not parse`)
    expect(text).toContain(`- project: ${PROJECT} — not created yet (for settings only this project uses)`)
  })

  test("what is written, merged — or that nothing is", () => {
    expect(report({}).text).toContain("Written: nothing. Every bay is on its defaults.")
    expect(report({ [PROJECT]: { shell: { dockHeight: 16 } } }).text).toContain(
      'Written, both files merged: {"shell":{"dockHeight":16}}',
    )
  })
})

describe("bays", () => {
  test("installed from OpenCode's plugin lists, in either version's spelling", () => {
    expect(baysOfEntry("opencode-cockpit@0.9.0")).toHaveLength(7)
    expect(baysOfEntry("/x/node_modules/opencode-cockpit")).toHaveLength(7)
    expect(baysOfEntry("@opencode-cockpit/shell@0.9.0")).toEqual(["shell"])
    expect(baysOfEntry("/x/node_modules/@opencode-cockpit/trail/")).toEqual(["trail"])
    expect(baysOfEntry("@opencode-cockpit/client")).toEqual([])
    expect(
      readInstalls(V1_TUI, JSON.stringify({ plugin: [["opencode-cockpit", { features: {} }]] })),
    ).toEqual([{ entry: "opencode-cockpit", bundle: true, file: V1_TUI, options: { features: {} } }])
    expect(
      readInstalls(V2_CLI, JSON.stringify({ plugins: [{ package: "@opencode-cockpit/status" }] })),
    ).toHaveLength(1)
  })

  test("a bay nobody installed is named once, and its settings are not offered", () => {
    const { text } = report({ [OPENCODE]: { plugins: ["@opencode-cockpit/shell"] } })
    expect(text).toContain("### shell — on")
    expect(text).not.toContain("### status")
    expect(text).toContain("Not installed: status, subagents, trail, trust, review, updater.")
  })

  test("each value says where it came from; defaults are listed apart", () => {
    const { text } = report({
      [GLOBAL]: { shell: { dockHeight: 16, hideWhenEmpty: true } },
      [PROJECT]: { shell: { dockHeight: 20 } },
    })
    const shell = bay(text, "shell")
    expect(shell).toContain("- set: hideWhenEmpty true (global) · dockHeight 20 (project)")
    expect(shell).toContain("- defaults: enabled true · sidebar true · sidebarRows 5 ·")
    expect(shell).toContain("block: shown, hidden while empty")
  })

  test("plugin-entry options are a source of their own", () => {
    const { text } = report({
      [OPENCODE]: { plugins: [{ package: "opencode-cockpit", options: { trust: { threshold: 5 } } }] },
    })
    expect(bay(text, "trust")).toContain("threshold 5 (plugin options)")
  })

  test("off, and why: a file's switch, the entry's, or enabled", () => {
    expect(report({ [GLOBAL]: { features: { shell: false } } }).text).toContain(
      "### shell — off (`features` in a settings file)",
    )
    expect(
      report({
        [OPENCODE]: { plugins: [{ package: "opencode-cockpit", options: { features: { trail: false } } }] },
      }).text,
    ).toContain("### trail — off (`features` in the plugin entry)")
    expect(report({ [PROJECT]: { subagents: { enabled: false } } }).text).toContain(
      "### subagents — off (`enabled: false`)",
    )
  })

  test("where each block is: Status's surface, a hidden block, Trust's default", () => {
    const { text } = report({ [GLOBAL]: { status: { sidebar: false }, shell: { sidebar: false } } })
    expect(bay(text, "status")).toContain("block: a line under the prompt")
    expect(bay(text, "shell")).toContain("block: hidden (sidebar: false)")
    expect(bay(text, "trust")).toContain("block: hidden (sidebar: false)")
    expect(bay(text, "review")).toContain("block: no sidebar block")
  })

  test("the order, from the list or the default, of the blocks that are on", () => {
    expect(report({}).text).toContain(
      "## Bays (sidebar order, top to bottom: status, subagents, shell, trail, trust, the default)",
    )
    expect(report({ [GLOBAL]: { sidebar: ["trail", "status"] } }).text).toContain(
      "top to bottom: trail, status, subagents, shell, trust, from the `sidebar` list",
    )
  })
})

describe("OpenCode's own blocks", () => {
  test("reads the switches each version writes", () => {
    expect(
      readHostFile(
        1,
        V1_TUI,
        JSON.stringify({ plugin_enabled: { "internal:sidebar-todo": false, other: false } }),
      ).blocks,
    ).toEqual({ "internal:sidebar-todo": false })
    expect(readHostFile(2, V2_CLI, '{ "plugins": ["x", "-opencode.sidebar.context"] }').blocks).toEqual({
      "opencode.sidebar.context": false,
    })
    expect(readHostFile(2, V2_CLI, "{ nope").error).toBeTruthy()
  })

  test("suggests turning Context off when Status draws in the sidebar, in each version's syntax", () => {
    expect(report({}, { opencode: 1 }).text).toContain(
      `\`"plugin_enabled": { "${HOST_BLOCKS[1].context}": false }\``,
    )
    expect(report({}).text).toContain(`add \`"-${HOST_BLOCKS[2].context}"\` to the \`"plugins"\` list`)
  })

  test("no suggestion once it is off, or when Status is at the bottom", () => {
    const off = report({ [V2_CLI]: { plugins: ["-opencode.sidebar.context"] } }).text
    expect(off).toContain(`Context \`opencode.sidebar.context\`: off (set in ${V2_CLI}).`)
    expect(off).not.toContain("Suggest turning")
    expect(report({ [PROJECT]: { status: { sidebar: false } } }).text).not.toContain("Suggest turning")
  })

  test("Todo is never offered off; when it is off, turning it back on is offered", () => {
    expect(report({}, { opencode: 1 }).text).toContain("Never suggest turning it off")
    const off = report(
      { [V1_TUI]: { plugin_enabled: { "internal:sidebar-todo": false } } },
      { opencode: 1 },
    ).text
    expect(off).toContain("offer to turn it back on")
    expect(off).toContain('`"plugin_enabled": { "internal:sidebar-todo": true }`')
  })

  test("OpenCode 2 has no LSP, Todo or Files block to talk about", () => {
    const { text } = report({})
    expect(text).not.toContain("internal:sidebar-lsp")
    expect(text).toContain("OpenCode 2 has no LSP, Todo or Files block in the sidebar.")
  })

  test("every block each version has is listed by its id; the optional ones neutrally, either way", () => {
    const ids = (text: string) => [...text.matchAll(/^- \w+ `([\w.:-]+)`/gm)].map((match) => match[1])
    expect(ids(report({}).text)).toEqual([
      "opencode.sidebar.context",
      "opencode.sidebar.mcp",
      "opencode.sidebar.footer",
    ])
    expect(ids(report({}, { opencode: 1 }).text)).toEqual([
      "internal:sidebar-context",
      "internal:sidebar-mcp",
      "internal:sidebar-lsp",
      "internal:sidebar-files",
      "internal:sidebar-footer",
      "internal:sidebar-todo",
    ])
    const mcp = report({ [V2_CLI]: { plugins: ["-opencode.sidebar.mcp"] } }).text
    expect(mcp).toContain("- MCP `opencode.sidebar.mcp`: off (set in")
    expect(mcp).toContain("Status's table already warns when one fails")
    expect(mcp).toContain('Back on: remove `"-opencode.sidebar.mcp"`')
    expect(report({ [PROJECT]: { status: { sidebar: false } } }).text).not.toContain("Status's table already")
  })
})

/* ─── the second phase ──────────────────────────────────────────────────────────────────────── */

describe("tune", () => {
  const facts = (files: Record<string, string>, over: Partial<ReportInput> = {}) => {
    const input: ReportInput = {
      opencode: 2,
      directory: "/work/app",
      env: {},
      home: "/home/me",
      read: (path) => files[path],
      ...over,
    }
    return tuneFacts(input, (args) => (args[0] === "log" ? "COM-1 a\nCOM-2 b\n" : undefined))
  }

  test("the tour gives each bay that is on its keys as set now, and its commands", () => {
    const { report: r } = report({
      [GLOBAL]: { shell: { keybinds: { "cockpit.shells.dock": "<leader>d" } } },
    })
    const text = tuneText(r, facts({}))
    expect(text).toContain("- shell — background shells")
    expect(text).toContain("`<leader>d` `/shells-dock` show or hide the shells panel")
    expect(text).toContain("`<leader>j` `/shell` open the console")
    expect(text).toContain("`<leader>f` `/trail`")
    const off = report({ [GLOBAL]: { features: { trail: false } } }).report
    expect(tuneText(off, facts({}))).not.toContain("- trail —")
  })

  test("the project's long-running commands, ticket keys and AGENTS.md sections", () => {
    const files = {
      "/work/app/package.json": JSON.stringify({ scripts: { dev: "next dev", lint: "biome check" } }),
      "/work/app/AGENTS.md": `# Ours\n\n${sectionText("- Tickets are COM-…")}\n`,
    }
    const text = tuneText(report({}).report, facts(files))
    expect(text).toContain('- `npm run dev` — package.json "dev": "next dev"')
    expect(text).toContain("Other package.json scripts (they end on their own): lint")
    expect(text).toContain("COM (2, e.g. COM-1)")
    expect(text).toContain("- project: /work/app/AGENTS.md — has the Cockpit section. Now:")
    expect(text).toContain("    - Tickets are COM-…")
    expect(text).toContain("- global: /home/me/.config/opencode/AGENTS.md — not created yet")
    expect(text).toContain("Conventions only")
  })

  test("on OpenCode 1, creating AGENTS.md beside a CLAUDE.md is flagged", () => {
    const text = tuneText(
      report({}, { opencode: 1 }).report,
      facts({ "/work/app/CLAUDE.md": "x" }, { opencode: 1 }),
    )
    expect(text).toContain("/work/app/CLAUDE.md exists, and OpenCode 1 reads it only while there is no")
  })

  test("cockpit_conventions answers with what it did and the section as it now reads", () => {
    const added = writeSection("# Ours\n", "- a")
    if (!added.ok) throw new Error(added.error)
    const reply = conventionsReply("/work/app/AGENTS.md", added)
    expect(reply.split("\n")[0]).toBe(
      "Added the Cockpit section at the end of /work/app/AGENTS.md; everything before it is unchanged.",
    )
    expect(reply).toContain(sectionText("- a"))
  })
})

/* ─── the agent side ────────────────────────────────────────────────────────────────────────── */

function serverHost(scope: object = {}): ServerHost {
  return {
    version: 1,
    directory: "/work/app",
    scope,
    session: { get: async () => undefined, notify: async () => {} },
    readFile: async () => undefined,
    log: silentLog,
  }
}

describe("setupServer", () => {
  test("the tool, the skill and the command, once per OpenCode", () => {
    const scope = {}
    const first = setupServer(serverHost(scope), "opencode-cockpit")
    expect(Object.keys(first.tools ?? {})).toEqual([SETTINGS_TOOL, CONVENTIONS_TOOL])
    expect(first.skills).toEqual([{ dir: SETUP_SKILL_DIR }])
    expect(first.commands).toEqual([expect.objectContaining({ name: "cockpit-setup", prompt: SETUP_PROMPT })])
    expect(setupServer(serverHost(scope), "@opencode-cockpit/shell")).toEqual({})
  })

  test("the skill it points at is in the package", () => {
    expect(existsSync(join(SETUP_SKILL_DIR, "SKILL.md"))).toBe(true)
    expect(existsSync(join(SETUP_SKILL_DIR, "references", "settings.md"))).toBe(true)
  })

  test("the command's line names the skill", () => {
    expect(SETUP_PROMPT).toContain("cockpit-setup skill")
  })
})

/* ─── the interface's palette entry ─────────────────────────────────────────────────────────── */

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
                appendPrompt: async ({ text }: { text: string }) => void calls.push(`append ${text}`),
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
  test("the first entry in a window registers a palette entry with no slash name of its own", () => {
    const a = fakeHost()
    registerSetup(a.host, "opencode-cockpit")
    registerSetup({ ...a.host } as Host, "@opencode-cockpit/shell")
    expect(a.layers).toHaveLength(1)
    const command = (a.layers[0] as { commands: Record<string, unknown>[] }).commands[0]
    expect(command).toMatchObject({
      title: "Ask the agent to set up Cockpit",
      category: "Cockpit",
      namespace: "palette",
    })
    expect(command).not.toHaveProperty("slashName")
  })

  test("running it sends the command's own line", async () => {
    const fake = fakeHost({ version: 1 })
    registerSetup(fake.host, "opencode-cockpit")
    ;(fake.layers[0] as { commands: { run(): void }[] }).commands[0]?.run()
    await settle()
    expect(fake.calls).toEqual([`append ${SETUP_PROMPT}`, "submit"])
  })

  test("a claim is per window", () => {
    const { host } = fakeHost()
    expect(claimFeature(host.renderer, "setup", "x").active).toBe(true)
  })
})

describe("briefAgent, from every state", () => {
  test("OpenCode 2 at home: a conversation is made, opened, and asked", async () => {
    const fake = fakeHost()
    briefAgent(fake.host, "line", "Cockpit setup")
    await settle()
    expect(fake.calls).toEqual(["create", "navigate ses_new", "prompt ses_new default"])
    expect(fake.toasts).toEqual(["Asked the agent."])
  })

  test("OpenCode 2, agent busy: queued behind the running turn, not steered into it", async () => {
    const fake = fakeHost({ route: { name: "session", params: { sessionID: "ses_1" } }, status: "running" })
    briefAgent(fake.host, "line", "Cockpit setup")
    await settle()
    expect(fake.calls).toEqual(["prompt ses_1 queue"])
  })

  test("OpenCode 1: into the prompt and submitted, which starts or queues a turn itself", async () => {
    const fake = fakeHost({ version: 1 })
    briefAgent(fake.host, "line", "Cockpit setup")
    await settle()
    expect(fake.calls).toEqual(["append line", "submit"])
    expect(fake.toasts).toEqual(["Asked the agent."])
  })
})
