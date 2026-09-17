/**
 * Verifies what users would install: packs every package, installs the tarballs into a clean
 * project, then loads the plugin and runs a shell through the installed daemon.
 *
 *   bun scripts/pack-check.ts
 */
import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const root = join(import.meta.dir, "..")
const PACKAGES = ["protocol", "daemon", "client", "opencode"]
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
    const bad = listing.split("\n").filter((l) => /\/(test|dist|node_modules)\/|tsbuildinfo|tsconfig/.test(l))
    if (bad.length > 0) throw new Error(`${file} ships files it should not:\n${bad.join("\n")}`)
    if (!listing.includes("package/LICENSE") || !listing.includes("package/README.md")) {
      throw new Error(`${file} is missing LICENSE or README.md`)
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
        dependencies: { "opencode-cockpit": tarball("opencode-cockpit") },
        overrides,
      },
      null,
      2,
    ),
  )
  run(["bun", "install"], project)

  await Bun.write(
    join(project, "check.ts"),
    `
import plugin from "opencode-cockpit/server"
import { CockpitClient } from "@opencode-cockpit/client"
import { resolvePaths } from "@opencode-cockpit/protocol"
import { daemonEntry } from "./node_modules/opencode-cockpit/src/connect.ts"

if (plugin.id !== "opencode-cockpit" || typeof plugin.server !== "function") throw new Error("bad server export")
const entry = daemonEntry()
if (!entry.includes("node_modules/@opencode-cockpit/daemon/src/main.ts")) throw new Error("daemon entry not resolved from node_modules: " + entry)

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
console.log("installed plugin loads, daemon spawns from node_modules, shell runs")
`,
  )
  console.log(run(["bun", "check.ts"], project).trim())
  console.log(`pack check passed: ${files.join(", ")}`)
} finally {
  rmSync(work, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
}
