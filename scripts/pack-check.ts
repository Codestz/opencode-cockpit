/**
 * Verifies what users would install: packs every package, then installs each way a person can get
 * this — the bundle, and a single bay on its own — into its own clean project, loads the plugin and
 * runs a shell through the installed daemon.
 *
 * Separate projects on purpose: sharing one let the bundle's dependencies satisfy the standalone
 * package, which is the install the docs recommend for a single bay.
 *
 *   bun scripts/pack-check.ts
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const root = join(import.meta.dir, "..")
// Dependency order, matching the release workflow.
const PACKAGES = ["protocol", "daemon", "client", "shell", "status", "opencode"]
const work = mkdtempSync(join(tmpdir(), "cockpit-pack-"))
const tarballs = join(work, "tarballs")
// Short: unix socket paths are limited to 104 bytes on macOS.
const home = mkdtempSync("/tmp/ck-pack-")

const run = (cmd: string[], cwd: string) => {
  const result = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0) {
    console.error(`$ ${cmd.join(" ")}\n${result.stdout}\n${result.stderr}`)
    throw new Error(`command failed in ${cwd}`)
  }
  return result.stdout.toString()
}

try {
  // Publishing packs whatever is on disk; build first so dist/ is current.
  run(["bun", "run", "build"], root)

  const names: Record<string, string> = {}
  for (const dir of PACKAGES) {
    const pkg = await Bun.file(join(root, "packages", dir, "package.json")).json()
    run(["bun", "pm", "pack", "--destination", tarballs], join(root, "packages", dir))
    names[pkg.name] = pkg.version
  }
  const files = readdirSync(tarballs)
  const tarball = (name: string) => {
    const prefix = name.replace("@", "").replace("/", "-")
    const hit = files.find((f) => f.startsWith(`${prefix}-${names[name]}`))
    if (!hit) throw new Error(`no tarball for ${name}`)
    return `file:${join(tarballs, hit)}`
  }

  for (const file of files) {
    const listing = run(["tar", "tzf", join(tarballs, file)], work)
    const bad = listing.split("\n").filter((l) => /\/(test|node_modules)\/|tsbuildinfo|tsconfig/.test(l))
    if (bad.length > 0) throw new Error(`${file} ships files it should not:\n${bad.join("\n")}`)
    if (!listing.includes("package/LICENSE") || !listing.includes("package/README.md")) {
      throw new Error(`${file} is missing LICENSE or README.md`)
    }
    // Packing resolves workspace:* from bun.lock, which can lag behind a version bump. A stale
    // version here publishes a package whose dependencies do not exist (the 0.1.0 incident).
    const manifest = JSON.parse(run(["tar", "xOzf", join(tarballs, file), "package/package.json"], work))
    for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
      for (const [dep, range] of Object.entries((manifest[field] ?? {}) as Record<string, string>)) {
        if (!(dep in names)) continue
        if (range !== names[dep]) {
          throw new Error(
            `${manifest.name} ${field} pins ${dep}@${range} but the release version is ${names[dep]}. Run \`bun run version:set ${names[dep]}\` to update bun.lock.`,
          )
        }
      }
    }
  }

  // Internal packages are not on the registry yet: point every reference at its tarball.
  const overrides = Object.fromEntries(Object.keys(names).map((n) => [n, tarball(n)]))
  /**
   * Every way a person can install this, each in its own project.
   *
   * They used to share one, which meant the bundle's dependencies could satisfy the standalone
   * package and hide a missing one — exactly the install the docs recommend for a single bay.
   */
  const installs = [
    { name: "bundle", packages: ["opencode-cockpit"] },
    { name: "shell alone", packages: ["@opencode-cockpit/shell"] },
    { name: "status alone", packages: ["@opencode-cockpit/status"] },
  ]

  for (const install of installs) {
    const dir = join(work, install.name.replace(/\s+/g, "-"))
    mkdirSync(dir, { recursive: true })
    await Bun.write(
      join(dir, "package.json"),
      JSON.stringify(
        {
          name: `pack-check-${install.name.replace(/\s+/g, "-")}`,
          private: true,
          type: "module",
          dependencies: Object.fromEntries(install.packages.map((p) => [p, tarball(p)])),
          overrides,
        },
        null,
        2,
      ),
    )
    run(["bun", "install"], dir)
    await verifyInstall(dir, install)
  }

  /**
   * Everything that must hold for one installed project: the interface entry is compiled, the host's
   * own solid/@opentui are used rather than bundled copies, the server entry exports a plugin, the
   * daemon resolves from this project alone, and a shell actually runs.
   */
  async function verifyInstall(dir: string, install: { name: string; packages: string[] }) {
    // OpenCode compiles plugin JSX with OpenTUI's Solid transform, whose Bun plugin skips every file
    // under node_modules, where published plugins always live. Raw JSX there renders once and never
    // updates (the 0.1.3/0.1.4 frozen-panel bug), so the published entry must already be compiled.
    for (const pkg of install.packages) {
      const entry = Bun.resolveSync(`${pkg}/tui`, dir)
      if (!entry.endsWith(".js"))
        throw new Error(`${install.name}: ${pkg}/tui must publish compiled JS, got ${entry}`)
    }

    // Each bay draws with Solid, so each bay's published entry has to be transformed output.
    const bays = install.packages.includes("opencode-cockpit")
      ? ["@opencode-cockpit/shell", "@opencode-cockpit/status"]
      : install.packages
    for (const bay of bays) {
      const entry = Bun.resolveSync(`${bay}/tui`, dir)
      const compiled = await Bun.file(entry).text()
      for (const marker of ['from "@opentui/solid"', "createComponent"]) {
        if (!compiled.includes(marker)) {
          throw new Error(`${install.name}: ${entry} is not Solid-compiled output (missing ${marker})`)
        }
      }
      if (!compiled.includes('from "solid-js"')) {
        throw new Error(`${install.name}: ${bay}/tui should import solid-js by name, for OpenCode to rewrite`)
      }
    }
    if (install.packages.includes("opencode-cockpit")) {
      const bundleTui = await Bun.file(Bun.resolveSync("opencode-cockpit/tui", dir)).text()
      for (const bay of bays) {
        if (!bundleTui.includes(`${bay}/tui`)) {
          throw new Error(`the bundle's tui entry should load ${bay}'s compiled entry`)
        }
      }
    }

    /**
     * A statusline module is written against `@opencode-cockpit/status/segment`, so that subpath
     * has to resolve from a project that installed only this bay — otherwise every example in the
     * README fails for the people the README is written for.
     */
    if (bays.includes("@opencode-cockpit/status")) {
      for (const subpath of ["config", "segment"]) {
        const resolved = Bun.resolveSync(`@opencode-cockpit/status/${subpath}`, dir)
        if (!resolved.endsWith(".js")) {
          throw new Error(`${install.name}: status/${subpath} must publish JS, got ${resolved}`)
        }
      }
      const authoring = await import(Bun.resolveSync("@opencode-cockpit/status/segment", dir))
      for (const name of ["gradient", "contextRatio", "contextUsed", "compact", "money"]) {
        if (typeof authoring[name] !== "function") {
          throw new Error(`${install.name}: status/segment must export ${name}() for modules to use`)
        }
      }
    }
    for (const bundled of ["solid-js", "@opentui/core", "@opentui/solid"]) {
      if (existsSync(join(dir, "node_modules", bundled))) {
        throw new Error(
          `${install.name}: ${bundled} was installed with the plugin; the host's instance must be used`,
        )
      }
    }

    // The statusline bay has no server half and no daemon: there is nothing further to run.
    if (!bays.includes("@opencode-cockpit/shell")) {
      console.log(`  ${install.name}: loads, compiled interface entry, authoring subpaths resolve`)
      return
    }

    const servers = install.packages.map((pkg) =>
      pkg === "opencode-cockpit"
        ? `import bundle from "opencode-cockpit/server"\nif (bundle.id !== "opencode-cockpit" || typeof bundle.server !== "function") throw new Error("bad bundle server export")`
        : `import shell from "@opencode-cockpit/shell/server"\nif (shell.id !== "opencode-cockpit.shell" || typeof shell.server !== "function") throw new Error("bad shell server export")`,
    )

    await Bun.write(
      join(dir, "check.ts"),
      `
${servers.join("\n")}
import { CockpitClient } from "@opencode-cockpit/client"
import { resolvePaths } from "@opencode-cockpit/protocol"
import { daemonEntry } from "@opencode-cockpit/shell/connect"

// The TUI entries are checked statically instead: their solid-js / @opentui imports only resolve
// inside OpenCode, which rewrites them to its own instances (#6, #8).
const entry = daemonEntry()
// realpath both sides: on macOS /var is a symlink to /private/var.
if (!entry.startsWith(${JSON.stringify(realpathSync(dir))})) throw new Error("daemon must resolve from this install: " + entry)

const client = new CockpitClient({
  client: { name: "pack-check", version: "0" },
  paths: resolvePaths({ COCKPIT_HOME: ${JSON.stringify(join(home, install.name.replace(/\s+/g, "-")))} }),
  spawn: { entry, env: { COCKPIT_IDLE_TIMEOUT_MS: "0" } },
})
const info = await client.call("shell.start", { command: "sh", args: ["-c", "printf 'packed ok\\n'"], cwd: process.cwd(), owner: { project: process.cwd() } })
await client.call("shell.wait", { id: info.id, until: { exit: true }, timeoutMs: 5000 })
const page = await client.call("shell.read", { id: info.id, after: 0 })
if (page.lines[0]?.text !== "packed ok") throw new Error("unexpected output: " + JSON.stringify(page.lines))
await client.call("daemon.shutdown", { force: true })
client.close()
`,
    )
    run(["bun", "check.ts"], dir)
    console.log(`  ${install.name}: loads, daemon spawns from its own node_modules, shell runs`)
  }

  console.log(`pack check passed: ${files.join(", ")}`)
} finally {
  rmSync(work, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
}
