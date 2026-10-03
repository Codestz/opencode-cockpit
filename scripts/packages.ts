/**
 * Every published package, in the order the release workflow publishes them.
 *
 * The order is read from the publish loop in `.github/workflows/release.yml` rather than kept here:
 * that loop is what actually publishes, `pack-check.ts` already fails when a package is missing
 * from it, and a second list beside it would be a list to forget.
 */

import { join } from "node:path"

export const REPO = "Codestz/opencode-cockpit"
export const WORKFLOW = "release.yml"

export interface Published {
  /** The directory under `packages/`. */
  dir: string
  /** The npm name, from its package.json. */
  name: string
}

export async function publishOrder(root: string): Promise<Published[]> {
  const workflow = await Bun.file(join(root, ".github/workflows", WORKFLOW)).text()
  const dirs = /for dir in ([a-z ]+); do/.exec(workflow)?.[1]?.trim().split(/\s+/)
  if (!dirs) throw new Error(`${WORKFLOW} no longer has a publish loop this script can read`)
  return Promise.all(
    dirs.map(async (dir) => ({
      dir,
      name: (await Bun.file(join(root, "packages", dir, "package.json")).json()).name as string,
    })),
  )
}

/** Whether a package has ever been published. Trusted publishing cannot publish a first version. */
export async function existsOnNpm(name: string): Promise<boolean> {
  const response = await fetch(`https://registry.npmjs.org/${name.replace("/", "%2f")}`, {
    headers: { accept: "application/vnd.npm.install-v1+json" },
  })
  if (response.status === 404) return false
  if (!response.ok) throw new Error(`npm answered ${response.status} for ${name}`)
  return true
}
