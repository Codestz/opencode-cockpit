/**
 * The safety net's eyes: PR and issue links in the output of something the agent *ran* — a shell
 * command, an MCP call — and never in a file it read or a page it fetched, which measured as mostly
 * noise (docs/roadmap/v0.9/trail.md, "A safety net, never automatic"). What is found is never
 * recorded here.
 *
 * The agent half hears every finished call (`toolAfter`) and puts what it found to the agent on the
 * next request, as a choice: record it if you created or changed it.
 */

import { type Found, foundIn } from "./model.ts"

/**
 * Tools whose output is not something the agent made happen: reading and searching (files, the web,
 * code), editing (its own words back), planning, and asking. A subagent's answer (`task`/`subagent`)
 * repeats what the subagent printed — counted once already, from the subagent's own calls — beside
 * links it only read about. Code Mode's `execute` carries `search(…)` results: the tool catalog.
 * Everything else counts: `bash`/`shell`, Cockpit's shells, and MCP tools (`<server>_<tool>`, whose
 * names nobody can list in advance).
 */
const NOT_RUN = new Set([
  "read",
  "glob",
  "grep",
  "list",
  "ls",
  "webfetch",
  "websearch",
  "codesearch",
  "edit",
  "write",
  "multiedit",
  "patch",
  "apply_patch",
  "todoread",
  "todowrite",
  "task",
  "subagent",
  "skill",
  "question",
  "lsp",
  "invalid",
  "batch",
  "execute",
  "search",
  "plan_enter",
  "plan_exit",
  "trail_add",
  "trail_list",
  "subagents_list",
  "subagents_read",
  "subagents_wait",
  "review_list",
  "review_open",
  "review_reply",
])

/** Whether a call's output is something the agent ran: where a PR it opened would be printed. */
export function ran(tool: string): boolean {
  const name = tool.toLowerCase()
  return !NOT_RUN.has(name) && !name.startsWith("lsp_")
}

/** The PRs and issues in one finished call's output, or none when the call does not count. */
export function findsOf(call: { tool: string; output: string }, at: number): Found[] {
  return ran(call.tool) && call.output ? foundIn(call.output, at) : []
}

/** Finds added to a list, each link once — the earliest sighting kept. */
export function addFinds(list: Found[], more: readonly Found[]): boolean {
  let added = false
  for (const found of more)
    if (!list.some((each) => each.url === found.url)) {
      list.push(found)
      added = true
    }
  return added
}
