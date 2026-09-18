/**
 * Prepares a release: bumps every package, promotes the changelog's Unreleased notes, commits and
 * tags. Publishing itself happens in CI when the tag is pushed.
 *
 *   bun scripts/release.ts patch          # 0.1.5 → 0.1.6
 *   bun scripts/release.ts minor          # 0.1.5 → 0.2.0
 *   bun scripts/release.ts 1.0.0-rc.1     # explicit
 *   bun scripts/release.ts patch --push   # also push main and the tag
 *   bun scripts/release.ts patch --dry-run
 */
import { join } from "node:path"

const root = join(import.meta.dir, "..")
const args = process.argv.slice(2)
const dryRun = args.includes("--dry-run")
const push = args.includes("--push")
const target = args.find((a) => !a.startsWith("--"))
const REPO = "https://github.com/Codestz/opencode-cockpit"

if (!target) {
  console.error("usage: bun scripts/release.ts <patch|minor|major|x.y.z> [--push] [--dry-run]")
  process.exit(1)
}

/** Set once the release has started editing files, so a later failure can put them back. */
let mutated = false

/**
 * A half-prepared release is worse than none: the next run sees bumped versions and a promoted
 * changelog, then refuses for reasons that have nothing to do with the real failure. So anything
 * this script wrote is restored before it gives up.
 */
function revert(): void {
  if (!mutated || dryRun) return
  mutated = false
  const restore = Bun.spawnSync(
    ["git", "checkout", "--", "package.json", "packages", "bun.lock", "CHANGELOG.md"],
    { cwd: root, stdout: "pipe", stderr: "pipe" },
  )
  console.error(
    restore.exitCode === 0
      ? "✗ release aborted; the version bump and changelog were rolled back"
      : "✗ release aborted, and the rollback failed — check `git status`",
  )
}

const run = (cmd: string[], allowFail = false) => {
  if (dryRun) {
    console.log(`(dry run) $ ${cmd.join(" ")}`)
    return ""
  }
  const result = Bun.spawnSync(cmd, { cwd: root, stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0 && !allowFail) {
    console.error(`$ ${cmd.join(" ")}\n${result.stdout}\n${result.stderr}`)
    revert()
    process.exit(1)
  }
  return result.stdout.toString().trim()
}

const fail = (message: string) => {
  revert()
  console.error(`✗ ${message}`)
  process.exit(1)
}

// A release must describe exactly one commit of one branch: refuse anything ambiguous.
const branch = run(["git", "rev-parse", "--abbrev-ref", "HEAD"])
if (branch !== "main" && !dryRun) fail(`releases are cut from main, not ${branch}`)
if (run(["git", "status", "--porcelain"]).length > 0 && !dryRun) {
  fail("working tree is dirty; commit or stash first")
}

const current = (await Bun.file(join(root, "package.json")).json()).version as string
const next = resolveVersion(current, target)
if (run(["git", "tag", "-l", `v${next}`]).length > 0) fail(`v${next} already exists`)
console.log(`${current} → ${next}`)

// Everything that can fail for reasons unrelated to the release runs first, on an untouched tree.
run(["bun", "run", "build"])
run(["bun", "run", "check"])

mutated = true
run(["bun", "scripts/set-version.ts", next])
await promoteChangelog(next)

// Then again on the tree that will ship: pack:check is the guard that catches a bad bump.
run(["bun", "run", "build"])
run(["bun", "run", "check"])
run(["bun", "run", "pack:check"])
run(["git", "add", "-A"])
// The version bump may be a no-op when a release is re-cut from an already prepared tree.
if (dryRun || run(["git", "status", "--porcelain"]).length > 0) {
  run(["git", "commit", "-m", `Release ${next}`])
} else {
  console.log("nothing to commit; tagging the current commit")
}
run(["git", "tag", "-a", `v${next}`, "-m", `v${next}`])

if (push) {
  run(["git", "push", "origin", "main"])
  run(["git", "push", "origin", `v${next}`])
  console.log(`pushed v${next}; the release workflow publishes it`)
} else {
  console.log(`committed and tagged v${next}. Push with:\n  git push origin main v${next}`)
}

function resolveVersion(from: string, request: string): string {
  if (/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(request)) return request
  const [major = 0, minor = 0, patch = 0] = from.split("-")[0]?.split(".").map(Number) ?? []
  switch (request) {
    case "major":
      return `${major + 1}.0.0`
    case "minor":
      return `${major}.${minor + 1}.0`
    case "patch":
      return `${major}.${minor}.${patch + 1}`
    default:
      fail(`unknown version "${request}"; use patch, minor, major or an explicit semver`)
      return ""
  }
}

/** Moves the Unreleased notes under a dated heading and rewrites the comparison links. */
async function promoteChangelog(version: string): Promise<void> {
  const file = join(root, "CHANGELOG.md")
  const text = await Bun.file(file).text()
  const previous = /^\[Unreleased\]: .*compare\/v([\d.]+(?:-[\w.]+)?)\.\.\.HEAD$/m.exec(text)?.[1]
  const start = text.indexOf("## [Unreleased]")
  if (start === -1) fail("CHANGELOG.md has no ## [Unreleased] section")
  const body = text.slice(start + "## [Unreleased]".length, indexOfNextHeading(text, start)).trim()

  let updated = text
  if (body.length === 0) {
    if (!text.includes(`## [${version}]`)) fail("nothing under Unreleased and no section for this version")
    console.log(`changelog: ## [${version}] already written`)
  } else {
    const date = new Date().toISOString().slice(0, 10)
    updated = `${text.slice(0, start)}## [Unreleased]\n\n## [${version}] - ${date}\n\n${body}\n\n${text.slice(indexOfNextHeading(text, start))}`
  }

  updated = updated.replace(
    /^\[Unreleased\]: .*$/m,
    `[Unreleased]: ${REPO}/compare/v${version}...HEAD${previous && previous !== version ? `\n[${version}]: ${REPO}/compare/v${previous}...v${version}` : ""}`,
  )
  if (dryRun) {
    console.log(`(dry run) changelog would gain ## [${version}]`)
    return
  }
  await Bun.write(file, updated)
}

function indexOfNextHeading(text: string, from: number): number {
  const next = text.indexOf("\n## [", from + 1)
  return next === -1 ? text.length : next + 1
}
