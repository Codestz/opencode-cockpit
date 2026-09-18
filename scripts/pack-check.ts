/**
 * Verifies what users would install: packs every package, installs the tarballs into a clean
 * project, then loads the plugin and runs a shell through the installed daemon.
 *
 *   bun scripts/pack-check.ts
 */
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const root = join(import.meta.dir, "..")
// Dependency order, matching the release workflow.
const PACKAGES = ["protocol", "daemon", "client", "shell", "opencode"]
const work = mkdtempSync(join(tmpdir(), "cockpit-pack-"))
const tarballs = join(work, "tarballs")
const project = join(work, "project")
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
  await Bun.write(
    join(project, "package.json"),
    JSON.stringify(
      {
        name: "pack-check",
        private: true,
        type: "module",
        // The bundle and a standalone feature, as users can install either or both.
        dependencies: {
          "opencode-cockpit": tarball("opencode-cockpit"),
          "@opencode-cockpit/shell": tarball("@opencode-cockpit/shell"),
        },
        overrides,
      },
      null,
      2,
    ),
  )
  run(["bun", "install"], project)

  // OpenCode compiles plugin JSX with OpenTUI's Solid transform, whose Bun plugin skips every file
  // under node_modules, where published plugins always live. Raw JSX there renders once and never
  // updates (the 0.1.3/0.1.4 frozen-panel bug), so the published entry must already be compiled.
  // Bare solid-js / @opentui imports stay: the host rewrites those to its own instances.
  for (const pkg of ["@opencode-cockpit/shell", "opencode-cockpit"]) {
    const entry = Bun.resolveSync(`${pkg}/tui`, project)
    if (!entry.endsWith(".js")) throw new Error(`${pkg}/tui must publish compiled JS, got ${entry}`)
  }
  // Solid's transform turns JSX into createComponent/insert calls; their absence means the panel
  // would render once and freeze.
  const shellTui = Bun.resolveSync("@opencode-cockpit/shell/tui", project)
  const compiled = await Bun.file(shellTui).text()
  const bundleTui = await Bun.file(Bun.resolveSync("opencode-cockpit/tui", project)).text()
  if (!bundleTui.includes("@opencode-cockpit/shell/tui")) {
    throw new Error("the bundle's tui entry should load the shell feature's compiled entry")
  }
  for (const marker of ['from "@opentui/solid"', "createComponent"]) {
    if (!compiled.includes(marker)) {
      throw new Error(`${shellTui} is not Solid-compiled output (missing ${marker})`)
    }
  }
  if (!compiled.includes('from "solid-js"')) {
    throw new Error("shell/tui should import solid-js by name so OpenCode can rewrite it to its own instance")
  }
  for (const bundled of ["solid-js", "@opentui/core", "@opentui/solid"]) {
    if (existsSync(join(project, "node_modules", bundled))) {
      throw new Error(`${bundled} was installed with the plugin; the host's instance must be used instead`)
    }
  }

  await Bun.write(
    join(project, "check.ts"),
    `
import bundle from "opencode-cockpit/server"
import shell from "@opencode-cockpit/shell/server"
import { CockpitClient } from "@opencode-cockpit/client"
import { resolvePaths } from "@opencode-cockpit/protocol"
import { daemonEntry } from "@opencode-cockpit/shell/connect"

if (bundle.id !== "opencode-cockpit" || typeof bundle.server !== "function") throw new Error("bad bundle server export")
if (shell.id !== "opencode-cockpit.shell" || typeof shell.server !== "function") throw new Error("bad shell server export")
// The TUI entries are checked statically instead: their solid-js / @opentui imports only resolve
// inside OpenCode, which rewrites them to its own instances (#6, #8).
const entry = daemonEntry()
if (!entry.includes("node_modules/@opencode-cockpit/daemon/dist/main.js")) throw new Error("daemon entry not resolved from node_modules: " + entry)

const client = new CockpitClient({
  client: { name: "pack-check", version: "0" },
  paths: resolvePaths({ COCKPIT_HOME: ${JSON.stringify(home)} }),
  spawn: { entry, env: { COCKPIT_IDLE_TIMEOUT_MS: "0" } },
})
const info = await client.call("shell.start", { command: "sh", args: ["-c", "printf 'packed ok\\\\n'"], cwd: process.cwd(), owner: { project: process.cwd() } })
await client.call("shell.wait", { id: info.id, until: { exit: true }, timeoutMs: 5000 })
const page = await client.call("shell.read", { id: info.id, after: 0 })
if (page.lines[0]?.text !== "packed ok") throw new Error("unexpected output: " + JSON.stringify(page.lines))
await client.call("daemon.shutdown", { force: true })
client.close()
console.log("installed bundle and shell load, daemon spawns from node_modules, shell runs")
`,
  )
  console.log(run(["bun", "check.ts"], project).trim())
  console.log(`pack check passed: ${files.join(", ")}`)
} finally {
  rmSync(work, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
}
