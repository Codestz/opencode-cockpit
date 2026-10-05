/**
 * Every bay's preview, in every state, written to .golden/ — so a refactor that should change
 * nothing can prove it did not:
 *
 *   bun scripts/golden.ts          # write the snapshots (before)
 *   bun scripts/golden.ts --check  # compare against them (after); exits 1 and names what differs
 *
 * Each preview runs under a pseudo-terminal (`script`), so it draws in colour as it would for you:
 * a tone that changed is a difference too. Status gets an empty config of its own, so your settings
 * never leak into the snapshot.
 */
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const root = resolve(import.meta.dir, "..")
const out = join(root, ".golden")
const check = process.argv.includes("--check")
mkdirSync(out, { recursive: true })
const emptyConfig = join(out, "empty-config.json")
writeFileSync(emptyConfig, "{}\n")

const runs: Record<string, [string, string[]]> = {}
const add = (name: string, pkg: string, args: string[] = []) => (runs[name] = [pkg, args])

add("client", "client")
for (const fixture of ["turn", "created", "sprawl", "huge", "awkward", "images", "clean"])
  add(`review-${fixture}`, "review", ["--fixture", fixture, "--width", "120", "--height", "40"])
add("review-diff", "review", ["--diff", "--width", "120", "--height", "40"])
add("review-keys", "review", ["--keys", "--width", "120", "--height", "40"])
add("review-settings", "review", ["--settings", "2", "--width", "120", "--height", "40"])
add("shell", "shell", ["--width", "38", "--columns", "100"])
add("shell-notice", "shell", ["--part", "sidebar", "--notice", "--width", "30"])
add("status", "status", ["--config", emptyConfig])
add("status-bottom", "status", ["--config", emptyConfig, "--surface", "bottom", "--width", "120"])
for (const fixture of ["sample", "advisor", "late", "continued", "finished", "names", "empty", "calls"])
  add(`subagents-${fixture}`, "subagents", ["--fixture", fixture, "--columns", "100"])
add("subagents-widths", "subagents", ["--widths", "24,30,36,50"])
add("subagents-keys", "subagents", ["--keys", "--columns", "100"])
add("subagents-notice", "subagents", ["--notice", "--hide"])
for (const sample of ["empty", "one", "busy", "long", "project"])
  add(`trail-${sample}`, "trail", ["--sample", sample, "--columns", "100", "--rows", "24"])
add("trail-widths", "trail", ["--widths", "24,30,36,50"])
for (const sample of [
  "empty",
  "first",
  "busy",
  "dangerous",
  "families",
  "crowded",
  "crowded-paused",
  "paused",
  "trouble",
])
  for (const view of ["activity", "ledger"])
    add(`trust-${sample}-${view}`, "trust", [
      "--sample",
      sample,
      "--view",
      view,
      "--columns",
      "100",
      "--rows",
      "24",
    ])
add("trust-keys", "trust", ["--keys", "--columns", "100", "--rows", "24"])

const differs: string[] = []
for (const [name, [pkg, args]] of Object.entries(runs)) {
  const cwd = join(root, "packages", pkg)
  // `script` gives the preview a terminal, so it colours as it would for you; -q keeps its own lines out
  const result = spawnSync("script", ["-q", "/dev/null", "bun", "src/cli/preview.ts", ...args], {
    cwd,
    env: { ...process.env, NO_COLOR: "", COLUMNS: "120", LINES: "40", TZ: "UTC" },
    encoding: "utf8",
    timeout: 60_000,
  })
  const text = `${result.stdout}${result.stderr ? `\n--- stderr\n${result.stderr}` : ""}`.replace(/\r/g, "")
  const file = join(out, `${name}.txt`)
  if (!check) {
    writeFileSync(file, text)
    continue
  }
  if (!existsSync(file) || readFileSync(file, "utf8") !== text) {
    differs.push(name)
    writeFileSync(join(out, `${name}.now.txt`), text)
  }
}
const count = Object.keys(runs).length
if (!check) console.log(`wrote ${count} previews to .golden/`)
else if (differs.length === 0) console.log(`${count} previews: identical`)
else {
  console.log(`${differs.length} of ${count} previews differ (the new output is beside each, as .now.txt):`)
  for (const name of differs) console.log(`  ${name}`)
  process.exit(1)
}
