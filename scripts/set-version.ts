/**
 * Sets one version across every package. Internal dependencies stay `workspace:*`; `bun publish`
 * rewrites them to this version.
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
