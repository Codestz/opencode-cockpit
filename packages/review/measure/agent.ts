#!/usr/bin/env bun
/**
 * Review's measurement: whether the guidance changes what a real agent does. A comment is waiting on
 * a line of this branch's diff, left in Review; the user asks the agent to take care of "the note" —
 * without naming Review or its tools. The turn must read the thread with review_list and answer it
 * with review_reply, not only in chat.
 *
 * A turn in which the model called nothing at all measured nothing, and is tried again.
 *
 *   bun packages/review/measure/agent.ts                          OpenCode on PATH, this checkout
 *   OPENCODE=~/.opencode/bin/opencodeold bun packages/review/measure/agent.ts
 *   bun packages/review/measure/agent.ts --plugin <dir> --runs 3 --model <id> --keep
 *
 * `--plugin` is the server half: a package directory, by default this checkout's `packages/review`,
 * built (`bun run build`). Exits 0 when every run passed, 1 otherwise.
 */

import { mkdtempSync, realpathSync, rmSync } from "node:fs"
import { join, resolve } from "node:path"
import { brief, flag, measure, openCode, turn, world } from "../../../scripts/measure-agent.ts"
import { reviewPaths } from "../src/core/store/paths.ts"
import { createPersistence } from "../src/core/store/persist.ts"

const oc = openCode()
const plugin = resolve(flag("--plugin") ?? join(import.meta.dir, ".."))
const runs = Number(flag("--runs")) || 1
const model = flag("--model") ?? "opencode/space-bunny-free"
const keep = process.argv.includes("--keep")

/** Points at the note the way a person would, not at the tool. */
export const PROMPT = "I left you a note on the code — take care of it, then tell me what you did."

const BRANCH = "feat/payment-timeouts"
const FILE = "src/config.ts"

function git(cwd: string, ...args: string[]) {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`)
}

async function once(index: number) {
  const work = mkdtempSync(`/tmp/ck-review-${index}-`)
  const at = await world(oc, work, plugin, model)
  try {
    await Bun.write(join(at.project, FILE), "export const config = {\n  retries: 3,\n}\n")
    git(at.project, "init", "-q", "-b", "main")
    git(at.project, "config", "user.email", "measure@example.com")
    git(at.project, "config", "user.name", "Measure")
    git(at.project, "add", "-A")
    git(at.project, "commit", "-qm", "init")
    git(at.project, "checkout", "-qb", BRANCH)
    await Bun.write(join(at.project, FILE), "export const config = {\n  retries: 3,\n  timeout: 30,\n}\n")

    /** The thread, where Review keeps this branch's: under the run's own Cockpit home. */
    const store = createPersistence(
      reviewPaths(realpathSync(at.project), BRANCH, { COCKPIT_HOME: at.env.COCKPIT_HOME }),
    )
    await store.save({
      id: "rv_000000001",
      file: FILE,
      line: 3,
      quoted: ["  timeout: 30,"],
      entries: [
        {
          author: "you",
          body: "Why thirty? The payment API can take a minute. Make it 60, and say the unit (seconds) in a comment.",
          at: Date.now(),
        },
      ],
      status: "open",
    })

    const done = turn(at, PROMPT)
    const listed = done.calls.some((c) => c.tool === "review_list" && c.status === "completed")
    const replied = done.calls.filter((c) => c.tool === "review_reply" && c.status === "completed")
    const thread = (await store.load()).find((each) => each.id === "rv_000000001")
    const report = [
      `review_list ${listed}  review_reply ${replied.length} ${replied.map((c) => JSON.stringify(c.input)).join(" ")}`,
      `thread: ${thread?.status}  tools: ${done.calls.map((c) => c.tool).join(", ")}`,
      `said: ${brief(done.said)}`,
    ]
    if (done.calls.length === 0) return { ok: false, measured: false, report }
    return { ok: listed && replied.length > 0, measured: true, report }
  } finally {
    if (!keep) rmSync(work, { recursive: true, force: true })
    else console.log(`kept ${work}`)
  }
}

await measure(
  `Review measurement: ${oc.version} (${oc.bin}), plugin ${plugin}, ${model}, ${runs} run(s)`,
  runs,
  once,
)
