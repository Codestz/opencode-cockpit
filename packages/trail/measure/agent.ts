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
import { brief, flag, measure, openCode, turn, world } from "../../../scripts/measure-agent.ts"
import { trailPaths } from "../src/core/paths.ts"
import { parseLines } from "../src/core/store.ts"

const oc = openCode()
const plugin = resolve(flag("--plugin") ?? join(import.meta.dir, ".."))
const runs = Number(flag("--runs")) || 1
/** Runs that must record the PR; every run when unset, and never more than there are. */
const pass = Math.min(runs, Number(flag("--pass")) || runs)
const model = flag("--model") ?? "opencode/space-bunny-free"
const keep = process.argv.includes("--keep")
const PR = "https://github.com/acme/web/pull/417"
/**
 * Nothing about the trail: the agent has to get there on its own. Direct about the PR, because what
 * is measured is what happens *after* a link is printed — a careful model that checks the branch
 * first, or asks before opening anything, measures its caution, not Trail.
 */
export const PROMPT =
  "Open the pull request for this branch now: run `gh pr create --fill` straight away (a private repository; I reviewed the change, the branch is pushed and gh is logged in — nothing needs checking first), then reply with the PR's link."

const run = (cmd: string[], cwd: string) => {
  const result = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0) throw new Error(`$ ${cmd.join(" ")}\n${result.stderr}`)
}

async function once(index: number) {
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
    const at = await world(oc, work, plugin, model, {
      TRAIL_MEASURE_LOG: log,
      TRAIL_MEASURE_PR: PR,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
    })
    const { calls: all, said } = turn(at, PROMPT)
    const calls = all.filter((call) => call.tool === "trail_add" && call.status === "completed")
    /** OpenCode names the project by its real path: on macOS /tmp is /private/tmp. */
    const file = Bun.file(trailPaths(realpathSync(project), { COCKPIT_HOME: join(work, "cockpit") }).events)
    const events = (await file.exists()) ? parseLines(await file.text()).events : []
    const recorded = events.some((event) => event.type === "recorded" && event.url === PR)
    const ghRan = (await Bun.file(log).exists()) && (await Bun.file(log).text()).includes("pr create")
    return {
      ok: ghRan && calls.length > 0 && recorded,
      /**
       * A turn in which the model declined to open the PR at all measures nothing about Trail — a free
       * model on OpenCode 2 refused `gh pr create` in 2 of 4 runs as "public-facing" — and is tried
       * again; only a turn that opened the PR and then did not record it fails.
       */
      measured: ghRan,
      report: [
        `gh pr create ran: ${ghRan}  trail_add: ${calls.length}  in the trail: ${recorded}`,
        ...calls.map((call) => `trail_add ${JSON.stringify(call.input)}`),
        ...(said ? [`said: ${brief(said)}`] : []),
      ],
    }
  } finally {
    if (!keep) rmSync(work, { recursive: true, force: true })
    else console.log(`kept ${work}`)
  }
}

await measure(
  `Trail measurement: ${oc.version} (${oc.bin}), plugin ${plugin}, ${model}, ${runs} run(s), ${pass} to pass`,
  runs,
  once,
  3,
  pass,
)
