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
 * A package already linked fails with "already exists" and is reported, not treated as an error.
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
  const proc = Bun.spawn(
    ["npm", "trust", "github", name, "--file", WORKFLOW, "--repository", REPO, "--allow-publish", "--yes"],
    { cwd: root, stdin: "inherit", stdout: "pipe", stderr: "pipe" },
  )
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  const code = await proc.exited
  const said = `${out}${err}`.trim()
  if (code === 0) console.log(`✓ ${name}: linked to ${REPO} ${WORKFLOW}`)
  else if (/already exists|already configured/i.test(said)) console.log(`✓ ${name}: already linked`)
  else {
    console.log(`✗ ${name}:\n${said}`)
    failed.push(name)
  }
}

if (failed.length > 0) {
  console.error(`\n${failed.length} not linked: ${failed.join(", ")}`)
  process.exit(1)
}
console.log(`\nAll ${chosen.length} linked. The release workflow publishes them with no token.`)
