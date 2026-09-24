/**
 * Sets one version across every package and refreshes bun.lock. Internal dependencies stay
 * `workspace:*`; packing rewrites them to the version recorded in the lockfile.
 *
 *   bun scripts/set-version.ts 0.2.0
 */
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"

const version = process.argv[2]
if (!version || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error("usage: bun scripts/set-version.ts <semver>")
  process.exit(1)
}

const root = join(import.meta.dir, "..")

/**
 * Workspace directories that actually hold a package. A deleted branch leaves `dist/`, `types/` and
 * `node_modules/` behind, and a leftover directory is not something to version.
 */
function packageDirs(): string[] {
  const base = join(root, "packages")
  return readdirSync(base).filter((dir) => existsSync(join(base, dir, "package.json")))
}
const manifests = [
  join(root, "package.json"),
  ...packageDirs().map((dir) => join(root, "packages", dir, "package.json")),
]
for (const file of manifests) {
  const json = await Bun.file(file).json()
  json.version = version
  await Bun.write(file, `${JSON.stringify(json, null, 2)}\n`)
  console.log(`${json.name} → ${version}`)
}

// Packing resolves workspace:* from the versions recorded in bun.lock, and `bun install` does not
// update them for an existing lockfile. Rewrite just those fields so nothing else moves.
const lockPath = join(root, "bun.lock")
let lock = await Bun.file(lockPath).text()
for (const dir of packageDirs()) {
  const pattern = new RegExp(`("packages/${dir}": \\{\\s*"name": "[^"]+",\\s*"version": ")[^"]+(")`)
  if (!pattern.test(lock)) {
    console.error(`bun.lock has no workspace entry for packages/${dir}`)
    process.exit(1)
  }
  lock = lock.replace(pattern, `$1${version}$2`)
}
await Bun.write(lockPath, lock)

/**
 * Install lines pin the version, because OpenCode never re-resolves a plugin spec: a bare name or
 * `@latest` stays on whatever it installed first. So every pinned line has to name the release being
 * cut — a stale pin is the same frozen install with extra steps. Only lines that already carry a
 * version are touched; the site's changelog is history and keeps what it said.
 */
const docs = [
  join(root, "README.md"),
  ...packageDirs().map((dir) => join(root, "packages", dir, "README.md")),
  ...[...new Bun.Glob("site/src/content/docs/**/*.{md,mdx}").scanSync(root)]
    .filter((file) => !file.endsWith("help/changelog.md"))
    .map((file) => join(root, file)),
  join(root, "site/src/data/landing.ts"),
]
/** v1's `opencode plugin x@v`, v2's `opencode plugin add x@v`, and v2's `"package": "x@v"` entries. */
const pinned =
  /((?:opencode plugin (?:add )?|"package": ")(?:opencode-cockpit|@opencode-cockpit\/[a-z]+))@\d+\.\d+\.\d+(?:-[\w.]+)?/g
for (const file of docs) {
  if (!existsSync(file)) continue
  const text = await Bun.file(file).text()
  const next = text.replace(pinned, `$1@${version}`)
  if (next !== text) {
    await Bun.write(file, next)
    console.log(`${file.slice(root.length + 1)}: install lines → ${version}`)
  }
}

const verify = Bun.spawnSync(["bun", "install", "--frozen-lockfile"], {
  cwd: root,
  stdout: "inherit",
  stderr: "inherit",
})
if (verify.exitCode !== 0) process.exit(verify.exitCode ?? 1)
console.log("bun.lock workspace versions updated")
