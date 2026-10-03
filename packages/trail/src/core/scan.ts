/**
 * The safety net's eyes: PR and issue links in the output of something the agent *ran* — a shell
 * command, an MCP call — and never in a file it read or a page it fetched, which measured as mostly
 * noise (docs/roadmap/v0.9/trail.md, "A safety net, never automatic"). What is found is offered; it is
 * never recorded here.
 *
 * Live, the agent half hears every finished call (`toolAfter`); for an older conversation — or one
 * from before OpenCode started — the interface reads the stored history the same way. Both pass
 * through `ran`, so they agree on which calls count.
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

/* ─── history ────────────────────────────────────────────────────────────────────────────────── */

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const texts = (content: unknown): string =>
  Array.isArray(content)
    ? content
        .flatMap((part) => (isObject(part) && typeof part.text === "string" ? [part.text] : []))
        .join("\n")
    : ""

const number = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined

/**
 * OpenCode 1's stored messages (`session.messages` → `[{ info, parts }]`): every tool part that
 * completed, its output a string even for MCP. Only tool parts — a link in the person's own prompt
 * is not something the agent ran (docs/opencode/trail-server.md).
 */
export function findsInV1(messages: readonly unknown[]): Found[] {
  const out: Found[] = []
  for (const message of messages) {
    const parts = isObject(message) && Array.isArray(message.parts) ? message.parts : []
    for (const part of parts) {
      if (!isObject(part) || part.type !== "tool" || typeof part.tool !== "string") continue
      const state = isObject(part.state) ? part.state : {}
      if (state.status !== "completed") continue
      const output = typeof state.output === "string" ? state.output : texts(state.content)
      const time = isObject(state.time) ? state.time : {}
      addFinds(out, findsOf({ tool: part.tool, output }, number(time.end) ?? number(time.start) ?? 0))
    }
  }
  return out
}

/**
 * OpenCode 2's messages (`session.message.list`, or `session.context`): an assistant's
 * `content: [{ type: "tool", name, state: { status, content: [{ text }], metadata } }]`. A plugin or
 * MCP call is an `execute` part there, its inner calls named only in `metadata.toolCalls` and its
 * output merged — so an `execute` counts when one of its calls is MCP (`server.tool`, with a dot) or
 * a shell, and none of them is `search` (the catalog, full of links).
 */
export function findsInV2(messages: readonly unknown[]): Found[] {
  const out: Found[] = []
  for (const message of messages) {
    const content = isObject(message) && Array.isArray(message.content) ? message.content : []
    const created = isObject(message) && isObject(message.time) ? number(message.time.created) : undefined
    for (const part of content) {
      if (!isObject(part) || part.type !== "tool" || typeof part.name !== "string") continue
      const state = isObject(part.state) ? part.state : {}
      if (state.status !== "completed") continue
      const time = isObject(part.time) ? part.time : {}
      const at = number(time.completed) ?? number(time.created) ?? created ?? 0
      const output = texts(state.content)
      if (part.name !== "execute") {
        addFinds(out, findsOf({ tool: part.name, output }, at))
        continue
      }
      const metadata = isObject(state.metadata) ? state.metadata : {}
      const calls = (Array.isArray(metadata.toolCalls) ? metadata.toolCalls : []).flatMap((call) =>
        isObject(call) && typeof call.tool === "string" ? [call.tool] : [],
      )
      const counts = calls.some((tool) => tool.includes(".") || tool.startsWith("shell"))
      if (counts && !calls.includes("search")) addFinds(out, foundIn(output, at))
    }
  }
  return out
}
