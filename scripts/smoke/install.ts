/**
 * The install a smoke run drives: build and pack every package, install what `SMOKE_INSTALL` names
 * the way a person would, and write OpenCode's config, Cockpit's and a project for it.
 *
 * - `bays` (the default): every bay as its own package, side by side.
 * - `bundle`: `opencode-cockpit` alone, which carries every bay.
 * - a bay's name (`shell`, `trust`, …): that package alone — the install the docs give for one bay.
 */

import { mkdtempSync } from "node:fs"
import { join } from "node:path"
import type { Feature as Bay } from "../../packages/opencode/src/features.ts"
import { FEATURES } from "../../packages/opencode/src/features.ts"
import { agent, root, run, v2, withBuildLock } from "./harness.ts"

export type Mode = "bays" | "bundle" | Bay

/**
 * The order the bays are configured in, which is the order OpenCode loads them — and the first
 * entry to load registers what every entry offers (`/cockpit-setup`). Kept as it always was.
 */
const ORDER: readonly Bay[] = ["shell", "status", "review", "updater", "subagents", "trail", "trust"]
const missing = FEATURES.filter((bay) => !ORDER.includes(bay))
if (missing.length > 0) throw new Error(`scripts/smoke/install.ts: add ${missing.join(", ")} to ORDER`)

export function readMode(raw = process.env.SMOKE_INSTALL || "bays"): Mode {
  if (raw === "bays" || raw === "bundle" || (FEATURES as readonly string[]).includes(raw)) return raw as Mode
  throw new Error(`SMOKE_INSTALL=${raw}: one of bays, bundle, ${FEATURES.join(", ")}`)
}

export interface Install {
  mode: Mode
  /** Everything the run writes, removed afterwards unless KEEP=1. */
  work: string
  /** A git checkout with one uncommitted change, where OpenCode is started. */
  project: string
  env: Record<string, string | undefined>
  /** The bays this install loads. */
  bays: readonly Bay[]
  /** Whether any entry ships an agent side: the one place `/cockpit-setup` comes from. */
  agentSide: boolean
  /** The plugin entry that loads `bay`: its own package, or the bundle. */
  entryOf(bay: Bay): string
}

export async function prepare(mode: Mode): Promise<Install> {
  const work = mkdtempSync("/tmp/ck-smoke-")
  const install = join(work, "install")
  const project = join(work, "project")
  const config = join(work, "config")
  const home = join(work, "home")

  const tarballs = join(work, "tarballs")
  await withBuildLock(() => {
    run(["bun", "run", "build"], root)
    /** The plumbing, then every bay — from the bundle's own list, so a new one cannot be left out. */
    for (const dir of ["protocol", "daemon", "client", "opencode", ...FEATURES]) {
      run(["bun", "pm", "pack", "--destination", tarballs], join(root, "packages", dir))
    }
  })
  const names = [...new Bun.Glob("*.tgz").scanSync(tarballs)]
  const file = (prefix: string) => `file:${join(tarballs, names.find((n) => n.startsWith(prefix)) as string)}`
  const pkg = (bay: Bay) => [`@opencode-cockpit/${bay}`, file(`opencode-cockpit-${bay}-`)]
  const bays = mode === "bays" || mode === "bundle" ? ORDER : [mode]
  /** The bundle's own name is a prefix of every bay's tarball: its version follows it directly. */
  const bundle = file(
    `opencode-cockpit-${(await Bun.file(join(root, "packages/opencode/package.json")).json()).version}`,
  )
  await Bun.write(
    join(install, "package.json"),
    JSON.stringify({
      name: "smoke",
      private: true,
      dependencies: mode === "bundle" ? { "opencode-cockpit": bundle } : Object.fromEntries(bays.map(pkg)),
      /** Not on the registry at this version: every package the install reaches comes from its tarball. */
      overrides: {
        "@opencode-cockpit/protocol": file("opencode-cockpit-protocol-"),
        "@opencode-cockpit/daemon": file("opencode-cockpit-daemon-"),
        "@opencode-cockpit/client": file("opencode-cockpit-client-"),
        ...(mode === "bundle" ? Object.fromEntries(ORDER.map(pkg)) : {}),
      },
    }),
  )
  run(["npm", "install"], install)

  /** Review reads git, so the project is a checkout with exactly one change to show. */
  await Bun.write(join(project, "SMOKE-REVIEW.ts"), "export const answer = 41\n")
  for (const cmd of [
    ["git", "init", "-q", "-b", "main"],
    ["git", "config", "user.email", "smoke@example.com"],
    ["git", "config", "user.name", "Smoke"],
    ["git", "add", "-A"],
    ["git", "commit", "-qm", "smoke"],
  ]) {
    run(cmd, project)
  }
  await Bun.write(join(project, "SMOKE-REVIEW.ts"), "export const answer = 42\n")

  // The plugins must live under node_modules: that is what disables OpenCode's Solid transform.
  const bayDir = (name: string) => join(install, "node_modules", "@opencode-cockpit", name)
  const bundleDir = join(install, "node_modules", "opencode-cockpit")
  /**
   * Which entries have an agent side, from what was installed. Status's agent side carries only the
   * `status-setup` skill and its commands; Trust's and the updater's carry nothing of their own.
   */
  const hasServer = async (dir: string) =>
    "./server" in (await Bun.file(join(dir, "package.json")).json()).exports
  const tuiEntries = mode === "bundle" ? [bundleDir] : bays.map(bayDir)
  const serverEntries: string[] = []
  for (const entry of tuiEntries) if (await hasServer(entry)) serverEntries.push(entry)
  /**
   * Where the install docs put them, which is where `opencode plugin add` writes. v1 reads `plugin`
   * from opencode.json (the agent side) and tui.json (the interface). v2 reads `plugins` from
   * opencode.json and loads both halves of every entry there — the bundle and each bay alike — so
   * every entry goes in opencode.json alone, and nothing in cli.json.
   */
  const files: [string, string, string, string[]][] = v2
    ? [["opencode.json", "https://opencode.ai/config.json", "plugins", tuiEntries]]
    : [
        ["opencode.json", "https://opencode.ai/config.json", "plugin", serverEntries],
        ["tui.json", "https://opencode.ai/tui.json", "plugin", tuiEntries],
      ]
  for (const [name, schema, key, plugins] of files) {
    if (name !== "opencode.json" && plugins.length === 0) continue
    /** v1's schema URLs mean nothing to v2, whose loader skipped files carrying them. */
    await Bun.write(
      join(config, "opencode", name),
      JSON.stringify({
        ...(v2 ? {} : { $schema: schema }),
        [key]: plugins,
        /** A model that needs no key, for the turns AGENT=1 runs inside the interface. */
        ...(agent && name === "opencode.json" ? { model: "opencode/space-bunny-free" } : {}),
        /**
         * The setup skills read and write Cockpit's config, outside the project: a prompt it would
         * wait on forever here. OpenCode 2 is started with `--auto` for the same reason.
         */
        ...(agent && !v2 && name === "opencode.json" ? { permission: { external_directory: "allow" } } : {}),
      }),
    )
  }
  /**
   * A statusline whose value has to come from somewhere the plugin cannot fake: a literal marker
   * proves the line drew at all, and a command segment proves the whole pipeline -- spawn, parse,
   * repaint -- works from a published build.
   *
   * The global file carries the section's name from before 0.9, `statusline`: it is not read, and
   * Status has to say so in a `!` row instead of drawing as if nothing had been written.
   */
  await Bun.write(
    join(config, "opencode-cockpit", "config.json"),
    JSON.stringify({ statusline: { preset: "minimal" } }),
  )
  await Bun.write(
    join(project, ".cockpit.json"),
    JSON.stringify({
      status: {
        surface: "bottom",
        segments: [
          { type: "text", value: "STATUSLINE-DREW" },
          { type: "command", name: "smoke" },
        ],
        commands: { smoke: { run: "printf 'COMMAND-RAN'", intervalMs: 250 } },
      },
      /** A value of the wrong kind in Review's section: the pane has to say so in a `!` row. */
      review: { source: 5 },
    }),
  )

  const env = {
    ...process.env,
    XDG_CONFIG_HOME: config,
    /** OpenCode's kv lives here: without its own, a run writes plugin state into the user's real one. */
    XDG_STATE_HOME: join(work, "state"),
    COCKPIT_HOME: home,
    TERM: "xterm-256color",
  }
  return {
    mode,
    work,
    project,
    env,
    bays,
    agentSide: serverEntries.length > 0,
    entryOf: (bay) => (mode === "bundle" ? bundleDir : bayDir(bay)),
  }
}
