#!/usr/bin/env bun
/**
 * Links every published package to the release workflow as an npm Trusted Publisher.
 *
 *   bun scripts/trust.ts            # every package in the publish loop
 *   bun scripts/trust.ts trust      # one package, by its directory under packages/
 *
 * Releases publish through GitHub's OIDC identity, with no token: npm no longer lets a token that
 * bypasses 2FA publish directly (it can only stage), and a stored token is a secret to leak. Each
 * package must be linked once, by a person — `npm trust` needs your interactive login and 2FA — and
 * npm only allows it for a package that already exists (see scripts/bootstrap-package.ts).
 *
 * A package already linked makes npm answer 409 "… already exists"; that one is done. All ten were
 * linked for 0.8.0 (see `npm trust list <package>`).
 */

import { join } from "node:path"
import { existsOnNpm, publishOrder, REPO, WORKFLOW } from "./packages.ts"

const root = join(import.meta.dir, "..")
const only = process.argv.slice(2).filter((arg) => !arg.startsWith("--"))
const all = await publishOrder(root)
const chosen = only.length > 0 ? all.filter((pkg) => only.includes(pkg.dir)) : all
if (chosen.length === 0) {
  console.error(`no such package; one of: ${all.map((pkg) => pkg.dir).join(", ")}`)
  process.exit(1)
}

const failed: string[] = []
for (const { dir, name } of chosen) {
  if (!(await existsOnNpm(name))) {
    console.log(`✗ ${name}: not on npm yet. First: bun scripts/bootstrap-package.ts ${dir}`)
    failed.push(name)
    continue
  }
  console.log(`\n→ ${name}`)
  /**
   * npm's own terminal, not a pipe: it asks for 2FA by opening a browser link and waiting for you to
   * approve it, and with its output piped it cannot wait — it stopped with EOTP instead.
   */
  const proc = Bun.spawn(
    ["npm", "trust", "github", name, "--file", WORKFLOW, "--repository", REPO, "--allow-publish", "--yes"],
    { cwd: root, stdin: "inherit", stdout: "inherit", stderr: "inherit" },
  )
  if ((await proc.exited) === 0) console.log(`✓ ${name}: linked to ${REPO} ${WORKFLOW}`)
  else {
    /**
     * npm answers a second link with 409 "a trusted publisher configuration … already exists": that
     * package is linked already. Checking first would cost another 2FA prompt per package, since npm
     * asks for it to list a package's trusted publishers too.
     */
    console.log(
      `✗ ${name}: see npm above. A 409 "configuration … already exists" means it is linked already.`,
    )
    failed.push(name)
  }
}

if (failed.length > 0) {
  console.error(`\n${failed.length} not linked: ${failed.join(", ")}`)
  process.exit(1)
}
console.log(`\nAll ${chosen.length} linked. The release workflow publishes them with no token.`)
