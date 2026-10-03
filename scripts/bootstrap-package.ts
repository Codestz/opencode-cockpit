#!/usr/bin/env bun
/**
 * Puts a new package on npm for the first time, so its releases can come from the workflow.
 *
 *   bun scripts/bootstrap-package.ts trust     # by its directory under packages/
 *
 * Trusted publishing cannot publish a package's first version: npm only lets a trusted publisher be
 * added to a package that already exists. So a new bay starts with an empty 0.0.0 — a package.json,
 * a README saying what it is, the licence, no code — published from your machine with your own
 * login and 2FA, then linked to the workflow (scripts/trust.ts). The real version follows from CI.
 * `@opencode-cockpit/trust` went out this way for 0.8.0.
 */

import { copyFileSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { existsOnNpm } from "./packages.ts"

const root = join(import.meta.dir, "..")
const dir = process.argv[2]
if (!dir) {
  console.error("usage: bun scripts/bootstrap-package.ts <directory under packages/>")
  process.exit(1)
}

const manifest = await Bun.file(join(root, "packages", dir, "package.json")).json()
const name = manifest.name as string
if (await existsOnNpm(name)) {
  console.log(`${name} is already on npm; link it with: bun scripts/trust.ts ${dir}`)
  process.exit(0)
}

const work = mkdtempSync(join(tmpdir(), "cockpit-bootstrap-"))
writeFileSync(
  join(work, "package.json"),
  `${JSON.stringify(
    {
      name,
      version: "0.0.0",
      description: `Placeholder so npm trusted publishing can be set up. The real package is published from CI.`,
      license: manifest.license,
      author: manifest.author,
      repository: manifest.repository,
      homepage: manifest.homepage,
      files: ["README.md", "LICENSE"],
      publishConfig: { access: "public" },
    },
    null,
    2,
  )}\n`,
)
writeFileSync(
  join(work, "README.md"),
  `# ${name} — placeholder\n\nThis version (0.0.0) contains no code. It exists only so npm's trusted publishing can be set up for\nthis package. Install the latest version, or the \`opencode-cockpit\` bundle.\n`,
)
copyFileSync(join(root, "LICENSE"), join(work, "LICENSE"))

console.log(`Publishing the ${name}@0.0.0 placeholder from ${work} — npm asks for your login and 2FA.`)
const publish = Bun.spawn(["npm", "publish", "--access", "public"], {
  cwd: work,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
})
if ((await publish.exited) !== 0) process.exit(1)

console.log(`\nWaiting for npm to list ${name}…`)
for (let attempt = 0; attempt < 30 && !(await existsOnNpm(name)); attempt++) await Bun.sleep(10_000)
if (!(await existsOnNpm(name))) {
  console.error(`${name} is not listed yet. When it is: bun scripts/trust.ts ${dir}`)
  process.exit(1)
}
console.log(`${name} is on npm. Now link it to the workflow: bun scripts/trust.ts ${dir}`)
