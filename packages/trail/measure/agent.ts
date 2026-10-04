#!/usr/bin/env bun
/**
 * Trail's fourth layer, the measurement (docs/roadmap/v0.9/trail.md, "Making sure the agent
 * records"): a real agent turn opens a pull request with a fake `gh` that prints its link, and the
 * turn must end with the agent having called `trail_add` for it — without the prompt saying a word
 * about the trail. Only the guidance, the tool's description and the "seen in output" line can make
 * it happen, so a wording change that stops it working cannot ship silently.
 *
 *   bun packages/trail/measure/agent.ts                         OpenCode on PATH, this checkout
 *   OPENCODE=~/.opencode/bin/opencodeold bun packages/trail/measure/agent.ts
 *   bun packages/trail/measure/agent.ts --plugin <dir> --runs 3 --keep
 *   bun packages/trail/measure/agent.ts --runs 3 --pass 2           two of three is a pass
 *
 * `--plugin` is the server half to load: a package directory (an install's
 * `node_modules/@opencode-cockpit/trail`, or the bundle's) — by default this checkout's
 * `packages/trail`, built (`bun run build`). Everything runs in a folder of its own: OpenCode's
 * config, state, data and cache, Cockpit's home, the project (a git repository on a branch). Needs
 * the network and a free OpenCode Zen model, so it stays out of CI — like `AGENT=1 smoke:tui`.
 *
 * Exits 0 when at least `--pass` runs recorded the PR (every run, unset), 1 otherwise, and prints
 * what each run did. A free model misses about one turn in six, so the smoke asks two of three.
 */

import { mkdtempSync, realpathSync, rmSync } from "node:fs"
import { join, resolve } from "node:path"
import { trailPaths } from "../src/core/paths.ts"
import { parseLines } from "../src/core/store.ts"

const args = process.argv.slice(2)
const value = (flag: string) => {
  const at = args.indexOf(flag)
  return at >= 0 ? args[at + 1] : undefined
}
const opencode = process.env.OPENCODE ?? Bun.which("opencode")
if (!opencode) {
  console.error("opencode binary not found: set OPENCODE")
  process.exit(2)
}
const plugin = resolve(value("--plugin") ?? join(import.meta.dir, ".."))
const runs = Number(value("--runs")) || 1
/** Runs that must record the PR; every run when unset, and never more than there are. */
const pass = Math.min(runs, Number(value("--pass")) || runs)
const model = value("--model") ?? "opencode/space-bunny-free"
const keep = args.includes("--keep")
const PR = "https://github.com/acme/web/pull/417"
/**
 * Nothing about the trail: the agent has to get there on its own. Direct about the PR, because what
 * is measured is what happens *after* a link is printed — a careful model that checks the branch
 * first, or asks before opening anything, measures its caution, not Trail.
 */
export const PROMPT =
  "Open the pull request for this branch now: run `gh pr create --fill` straight away (a private repository; I reviewed the change, the branch is pushed and gh is logged in — nothing needs checking first), then reply with the PR's link."

const version = Bun.spawnSync([opencode, "--version"]).stdout.toString().trim()
const v2 = version.replace(/^opencode\s+v?/, "").startsWith("2")

const run = (cmd: string[], cwd: string) => {
  const result = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0) throw new Error(`$ ${cmd.join(" ")}\n${result.stderr}`)
}

interface Outcome {
  ok: boolean
  ghRan: boolean
  /** `trail_add` calls that completed, with what was sent. */
  calls: unknown[]
  recorded: boolean
  said: string
}

/** Every tool call of a `--format json` run, Code Mode's inner calls included (v2 lists them on `execute`). */
function toolCalls(stdout: string): { tool: string; status?: string; input?: unknown }[] {
  const out: { tool: string; status?: string; input?: unknown }[] = []
  for (const line of stdout.split("\n")) {
    if (!line.startsWith("{")) continue
    const event = JSON.parse(line) as { type?: string; part?: Record<string, unknown> }
    if (event.type !== "tool_use" || !event.part) continue
    const part = event.part as {
      tool: string
      state: {
        status?: string
        input?: unknown
        metadata?: { toolCalls?: unknown[]; metadata?: { toolCalls?: unknown[] } }
      }
    }
    out.push({ tool: part.tool, status: part.state.status, input: part.state.input })
    const inner = part.state.metadata?.toolCalls ?? part.state.metadata?.metadata?.toolCalls ?? []
    for (const call of inner as { tool: string; status?: string; input?: unknown }[]) out.push(call)
  }
  return out
}

async function once(index: number): Promise<Outcome> {
  const work = mkdtempSync(`/tmp/acme-web-${index}-`)
  try {
    const project = join(work, "project")
    const log = join(work, "gh.log")
    /**
     * A branch with one commit, pushed — as far as git can tell without a network: the remote-tracking
     * refs are written by hand. A careful model checks before it opens a PR, and stops at an unpushed
     * branch or a missing remote.
     */
    await Bun.write(join(project, "README.md"), "# web\n")
    const branch = "feat/checkout-retry"
    for (const cmd of [
      ["git", "init", "-q", "-b", "main"],
      ["git", "config", "user.email", "measure@example.com"],
      ["git", "config", "user.name", "Measure"],
      ["git", "add", "-A"],
      ["git", "commit", "-qm", "init"],
      ["git", "remote", "add", "origin", "https://github.com/acme/web.git"],
      ["git", "update-ref", "refs/remotes/origin/main", "HEAD"],
      ["git", "checkout", "-qb", branch],
    ])
      run(cmd, project)
    /** A change that matches its commit message: a model that finds a one-liner under a big message stops to ask. */
    await Bun.write(
      join(project, "checkout.ts"),
      [
        "/** Retry the checkout request after a dropped connection, up to three times, backing off. */",
        "export async function checkout(send: () => Promise<Response>, retries = 3): Promise<Response> {",
        "  for (let attempt = 0; ; attempt++) {",
        "    try {",
        "      return await send()",
        "    } catch (error) {",
        "      if (attempt >= retries) throw error",
        "      await new Promise((done) => setTimeout(done, 200 * 2 ** attempt))",
        "    }",
        "  }",
        "}",
        "",
      ].join("\n"),
    )
    for (const cmd of [
      ["git", "add", "-A"],
      ["git", "commit", "-qm", "Retry the checkout request after a dropped connection"],
      ["git", "update-ref", `refs/remotes/origin/${branch}`, "HEAD"],
      ["git", "config", `branch.${branch}.remote`, "origin"],
      ["git", "config", `branch.${branch}.merge`, `refs/heads/${branch}`],
    ])
      run(cmd, project)
    /**
     * The fake `gh`, copied without its comments: a model that looks at what `gh` is (some do,
     * `which gh` and `cat`) and finds a script calling itself fake stops and says so.
     */
    const bin = join(work, "bin")
    const shim = await Bun.file(join(import.meta.dir, "bin", "gh")).text()
    await Bun.write(
      join(bin, "gh"),
      shim
        .split("\n")
        .filter((line, at) => at === 0 || !line.startsWith("#"))
        .join("\n"),
    )
    run(["chmod", "+x", join(bin, "gh")], work)
    await Bun.write(
      join(work, "config", "opencode", "opencode.json"),
      JSON.stringify({ [v2 ? "plugins" : "plugin"]: [plugin], model }),
    )
    const env = {
      ...process.env,
      XDG_CONFIG_HOME: join(work, "config"),
      XDG_STATE_HOME: join(work, "state"),
      XDG_DATA_HOME: join(work, "data"),
      XDG_CACHE_HOME: join(work, "cache"),
      COCKPIT_HOME: join(work, "cockpit"),
      TRAIL_MEASURE_LOG: log,
      TRAIL_MEASURE_PR: PR,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      /** v2 places the session in $PWD's directory, not the spawn's cwd (trail-interface.md). */
      PWD: project,
    }
    const cmd = [opencode as string, "run", ...(v2 ? ["--standalone", "--auto"] : []), "-m", model]
    /** stdin must not be an open pipe, or `opencode run` waits forever (trail-server.md). */
    const result = Bun.spawnSync([...cmd, "--format", "json", PROMPT], {
      cwd: project,
      env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: 300_000,
    })
    const stdout = result.stdout.toString()
    const calls = toolCalls(stdout).filter((call) => call.tool === "trail_add" && call.status === "completed")
    const said = stdout
      .split("\n")
      .filter((line) => line.startsWith('{"type":"text"'))
      .map((line) => (JSON.parse(line) as { part: { text: string } }).part.text)
      .join("\n")
    /** OpenCode names the project by its real path: on macOS /tmp is /private/tmp. */
    const file = Bun.file(trailPaths(realpathSync(project), { COCKPIT_HOME: join(work, "cockpit") }).events)
    const events = (await file.exists()) ? parseLines(await file.text()).events : []
    const recorded = events.some((event) => event.type === "recorded" && event.url === PR)
    const ghRan = (await Bun.file(log).exists()) && (await Bun.file(log).text()).includes("pr create")
    if (process.env.MEASURE_DEBUG) console.log(stdout.slice(-4000), result.stderr.toString().slice(-2000))
    return {
      ok: ghRan && calls.length > 0 && recorded,
      ghRan,
      calls: calls.map((c) => c.input),
      recorded,
      said,
    }
  } finally {
    if (!keep) rmSync(work, { recursive: true, force: true })
    else console.log(`kept ${work}`)
  }
}

console.log(
  `Trail measurement: ${version} (${opencode}), plugin ${plugin}, ${model}, ${runs} run(s), ${pass} to pass`,
)
let passed = 0
let ran = 0
/**
 * A turn in which the model declined to open the PR at all measures nothing about Trail — a free
 * model on OpenCode 2 refused `gh pr create` in 2 of 4 runs as "public-facing". Such a run is tried
 * again, up to `ATTEMPTS` times; only a turn that opened the PR and then did not record it fails.
 */
const ATTEMPTS = 3
for (let i = 1; i <= runs; i++) {
  /** Enough have passed: the rest would measure nothing more. */
  if (passed >= pass) break
  ran++
  let outcome = await once(i)
  for (let attempt = 2; !outcome.ghRan && attempt <= ATTEMPTS; attempt++) {
    console.log(
      `run ${i}: the model never ran gh pr create — no measurement, trying again (${attempt}/${ATTEMPTS})`,
    )
    if (outcome.said) console.log(`  said: ${outcome.said.replace(/\s+/g, " ").slice(0, 200)}`)
    outcome = await once(i)
  }
  if (outcome.ok) passed++
  console.log(
    `run ${i}: ${outcome.ok ? "PASS" : "FAIL"}  gh pr create ran: ${outcome.ghRan}  trail_add: ${outcome.calls.length}  in the trail: ${outcome.recorded}`,
  )
  for (const input of outcome.calls) console.log(`  trail_add ${JSON.stringify(input)}`)
  if (outcome.said) console.log(`  said: ${outcome.said.replace(/\s+/g, " ").slice(0, 200)}`)
}
console.log(`${passed} of ${ran} run(s) recorded the PR (${pass} needed)`)
process.exit(passed >= pass ? 0 : 1)
