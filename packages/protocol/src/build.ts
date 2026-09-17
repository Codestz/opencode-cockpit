import { createHash } from "node:crypto"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"

const SOURCE = /\.(ts|tsx|js|mjs|json)$/
const SKIP = new Set(["node_modules", "test", "dist"])

/**
 * Identity of the daemon code that `entry` would run: a hash of every source file in the entry's
 * package (its `src` directory, or the entry file itself when bundled). Daemon and client compute
 * it the same way, so a client can tell when a running daemon was started from different code.
 */
export function daemonBuildId(entry: string, version: string): string {
  const hash = createHash("sha256").update(version)
  const root = dirname(entry)
  const files = /[\\/]src$/.test(root) ? walk(root) : [entry]
  for (const file of files.sort()) {
    hash.update(relative(root, file)).update("\0").update(readFileSync(file)).update("\0")
  }
  return `${version}+${hash.digest("hex").slice(0, 12)}`
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else if (SOURCE.test(name)) out.push(path)
  }
  return out
}
