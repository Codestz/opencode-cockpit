/**
 * Sets one version across every package and refreshes bun.lock. Internal dependencies stay
 * `workspace:*`; packing rewrites them to the version recorded in the lockfile.
 *
 *   bun scripts/set-version.ts 0.2.0
 */
import { readdirSync } from "node:fs"
import { join } from "node:path"

const version = process.argv[2]
if (!version || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error("usage: bun scripts/set-version.ts <semver>")
  process.exit(1)
}

const root = join(import.meta.dir, "..")
const manifests = [
  join(root, "package.json"),
  ...readdirSync(join(root, "packages")).map((d) => join(root, "packages", d, "package.json")),
]
for (const file of manifests) {
  const json = await Bun.file(file).json()
  json.version = version
  await Bun.write(file, `${JSON.stringify(json, null, 2)}\n`)
  console.log(`${json.name} → ${version}`)
}

// bun.lock records workspace versions, and packing resolves workspace:* from it.
const install = Bun.spawnSync(["bun", "install"], { cwd: root, stdout: "inherit", stderr: "inherit" })
if (install.exitCode !== 0) process.exit(install.exitCode ?? 1)
console.log("bun.lock refreshed")
