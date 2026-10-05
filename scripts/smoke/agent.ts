/**
 * `AGENT=1` outside the interface: one real turn against the server halves, and each bay's own
 * behaviour measurement.
 */

import { join } from "node:path"
import { turn } from "../measure-agent.ts"
import { opencode, root, v2 } from "./harness.ts"
import type { Install } from "./install.ts"

/** What a probe asks of the agent turn: a tool to call, and the heading its guidance carries. */
export interface AgentAsk {
  /** As the prompt says it, after "call": the tool, and anything it is called with. */
  call: string
  tool: string
  heading?: string
}

const COUNT = ["", "one", "two", "three", "four", "five"]
const quoted = (headings: string[]) => {
  const all = headings.map((heading) => `'${heading}'`)
  return all.length > 1 ? `${all.slice(0, -1).join(", ")} and ${all.at(-1)}` : (all[0] ?? "")
}

/**
 * One real turn, by a free OpenCode Zen model, against the server halves — the only proof that the
 * tools registered and the system prompt carries the guidance, on either version. Needs the network
 * and a model willing to follow instructions, so it is opt-in.
 */
export function agentTurn(install: Install, asks: AgentAsk[]): void {
  const headings = asks.flatMap((ask) => (ask.heading ? [ask.heading] : []))
  const prompt = [
    `Call ${asks.map((ask) => ask.call).join(", then call ")}.`,
    ...(headings.length > 1
      ? [
          `Your system prompt has heading lines starting with ${quoted(headings)}.`,
          `Quote all ${COUNT[headings.length]} heading lines exactly in your reply.`,
        ]
      : headings.length === 1
        ? [
            `Your system prompt has a heading line starting with ${quoted(headings)}.`,
            "Quote it exactly in your reply.",
          ]
        : []),
  ].join(" ")
  const at = {
    oc: { bin: opencode, version: "", v2 },
    work: install.project,
    project: install.project,
    model: "opencode/space-bunny-free",
    env: install.env,
  }
  /** Bounded, and stdin closed: an open stdin or a permission prompt makes `opencode run` wait forever. */
  const { calls, said, stdout, stderr, finished } = turn(at, prompt)
  if (!finished) throw new Error(`the agent turn never finished (5 min):\n${stdout.slice(-3000)}`)
  const called = calls.filter((call) => call.status === "completed").map((call) => call.tool)
  const report = `${stdout}\n${stderr}`.slice(-3000)
  for (const { tool } of asks) {
    if (!called.includes(tool)) throw new Error(`the agent never completed ${tool}:\n${report}`)
  }
  for (const heading of headings) {
    if (!said.includes(heading)) throw new Error(`the agent was never told "${heading}":\n${report}`)
  }
}

/**
 * A bay's behaviour measurement (`packages/<bay>/measure/agent.ts`) against the entry this install
 * loads it from: the guidance has to change what a real turn does, without the prompt naming the bay.
 */
export function measure(install: Install, name: "trail" | "shell" | "review", what: string, runs: string[]) {
  const measured = Bun.spawnSync(
    ["bun", join(root, `packages/${name}/measure/agent.ts`), "--plugin", install.entryOf(name), ...runs],
    {
      cwd: root,
      env: { ...process.env, OPENCODE: opencode },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      /** Three attempts, of up to two five-minute turns each, inside each run of the measurement. */
      timeout: name === "trail" ? 6_000_000 : 2_000_000,
    },
  )
  if (measured.exitCode !== 0)
    throw new Error(`${what} measurement failed:\n${measured.stdout}\n${measured.stderr}`.slice(-3000))
}
