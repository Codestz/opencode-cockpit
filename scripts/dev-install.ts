/**
 * Installs this checkout into `~/.cockpit-dev` exactly as a user would get it, for trying it in a real
 * OpenCode:
 *
 *   bun run build && bun scripts/dev-install.ts
 *
 * Why not point OpenCode at `packages/opencode`: each package in the repo has the workspace's own
 * OpenTUI and Solid beside it (dev dependencies), so a plugin loaded from there brings a second copy
 * next to the host's. OpenCode 2 refuses that at start — `Environment variable "OPENTUI_FORCE_WCWIDTH"
 * is already registered with different configuration` — and even where it starts, two Solids do not
 * share reactivity. A packed install has none of them, so every import is the host's, as it is for
 * users. Run again after each build; the path stays the same, so configs need setting once.
 */

import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { FEATURES } from "../packages/opencode/src/features.ts"

const root = join(import.meta.dir, "..")
const target = process.env.COCKPIT_DEV_DIR ?? join(homedir(), ".cockpit-dev")
/**
 * Built beside the old one and swapped in by rename. OpenCode 2 watches a plugin's directory and
 * reloads on change; clearing the old install first had a running OpenCode reload a half-written one
 * and fail with `Cannot find package '@opencode-cockpit/client'`.
 */
const next = `${target}.next`
/**
 * Inside the install, and named relatively in its package.json: the directory is renamed into place,
 * and absolute paths into a temp directory left a package.json nobody could `npm install` again.
 */
const tarballs = join(next, "tarballs")

const run = (cmd: string[], cwd: string) => {
  const result = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0) throw new Error(`$ ${cmd.join(" ")}\n${result.stdout}\n${result.stderr}`)
}

rmSync(next, { recursive: true, force: true })
mkdirSync(tarballs, { recursive: true })
const packages = ["protocol", "daemon", "client", "opencode", ...FEATURES]
for (const dir of packages) run(["bun", "pm", "pack", "--destination", tarballs], join(root, "packages", dir))

const names = [...new Bun.Glob("*.tgz").scanSync(tarballs)]
/** The bundle's tarball is `opencode-cockpit-<version>`; every scoped one has its name after the dash. */
const tarball = (dir: string) => {
  const pattern = dir === "opencode" ? /^opencode-cockpit-\d/ : new RegExp(`^opencode-cockpit-${dir}-\\d`)
  return `file:./tarballs/${names.find((name) => pattern.test(name)) as string}`
}
const scoped = (dir: string) => (dir === "opencode" ? "opencode-cockpit" : `@opencode-cockpit/${dir}`)

await Bun.write(
  join(next, "package.json"),
  JSON.stringify({
    name: "cockpit-dev",
    private: true,
    dependencies: Object.fromEntries(["opencode", ...FEATURES].map((dir) => [scoped(dir), tarball(dir)])),
    overrides: Object.fromEntries(["protocol", "daemon", "client"].map((dir) => [scoped(dir), tarball(dir)])),
  }),
)
run(["npm", "install"], next)
const old = `${target}.old`
rmSync(old, { recursive: true, force: true })
if (existsSync(target)) renameSync(target, old)
renameSync(next, target)
rmSync(old, { recursive: true, force: true })

const bundle = join(target, "node_modules", "opencode-cockpit")
console.log(`installed into ${target}\n\nPoint both OpenCode versions at:\n  ${bundle}\n`)
console.log(`v1  opencode.json + tui.json:  "plugin": ["${bundle}"]`)
console.log(`v2  opencode.json + cli.json:  "plugins": ["${bundle}"]`)
