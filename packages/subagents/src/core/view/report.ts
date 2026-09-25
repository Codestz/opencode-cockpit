/**
 * The main agent's view of its subagents: what `subagents_list` answers.
 *
 * Written for a model, not a person — plain lines, every id in full, and the one thing it needs to do
 * with them said once: continue a subagent by its id rather than start a new one, so the follow-up
 * keeps everything that subagent already read and tried. Pure, like everything in `core/`.
 */

import type { Entry, Node } from "../model/model.ts"
import { elapsed } from "./rows.ts"

/** How much of a subagent's last answer the list repeats. */
const ANSWER = 400

export interface ReportInput {
  nodes: readonly Node[]
  now: number
  /** Which OpenCode: the id goes in `task_id` on 1 and `sessionID` on 2. */
  version: 1 | 2
}

export function subagentReport({ nodes, now, version }: ReportInput): string {
  if (nodes.length === 0) return "This conversation has no subagents yet."
  const how =
    version === 1
      ? "call the task tool with its id as task_id"
      : "call the subagent tool with its id as sessionID"
  const lines = [
    `Subagents of this conversation, oldest first. To follow up on work one of them did, continue that same subagent — ${how} — instead of launching a new one: it keeps everything it already read and tried.`,
    "",
  ]
  for (const { session, depth } of nodes) {
    const calls = session.entries.filter((entry) => entry.kind === "tool").length
    const rounds = session.entries.filter((entry) => entry.kind === "prompt").length
    /** What it said after it was last asked something: an answer only if it ended on words. */
    const since = session.entries.slice(lastPrompt(session.entries) + 1)
    const tail = since.at(-1)
    const answered = tail?.kind === "reply" && tail.text.trim() !== ""
    const cancelled = session.status === "failed" && /abort|interrupt|cancel/i.test(session.error ?? "")
    /** Idle before it did anything is finished, not working: nothing is coming from it. */
    const ended = session.status === "done" || (session.status === "starting" && session.ended !== undefined)
    const ago = elapsed(now - (session.ended ?? now))
    const state = cancelled
      ? `cancelled ${ago} ago — stopped before it finished${answered ? "" : ", no final answer"}`
      : ended
        ? answered
          ? `finished ${ago} ago`
          : `ended ${ago} ago without a final answer${since.length === 0 ? " (it never started on its task)" : ""}`
        : session.status === "failed"
          ? `failed${session.error ? ` (${session.error})` : ""}`
          : session.status === "waiting"
            ? "waiting for a permission"
            : "working now"
    const indent = "  ".repeat(depth)
    lines.push(
      `${indent}- ${session.id} · ${session.agent} · "${session.title || "subagent"}" · ${state} · ${calls} call${calls === 1 ? "" : "s"}${rounds > 1 ? ` · ${rounds} rounds` : ""}${session.background ? " · background" : ""}`,
    )
    if (session.task) lines.push(`${indent}  Task: ${clip(session.task, ANSWER)}`)
    const answer = lastAnswer(session.entries)
    if (answer)
      lines.push(
        answered
          ? `${indent}  Last answer: ${clip(answer, ANSWER)}`
          : `${indent}  Last words (a progress note, not its answer): ${clip(answer, ANSWER)}`,
      )
  }
  return lines.join("\n")
}

function lastPrompt(entries: readonly Entry[]): number {
  for (let i = entries.length - 1; i >= 0; i--) if (entries[i]?.kind === "prompt") return i
  return -1
}

function lastAnswer(entries: readonly Entry[]): string | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]
    if (entry?.kind === "reply" && entry.text.trim()) return entry.text
  }
  return undefined
}

const clip = (text: string, most: number): string => {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > most ? `${flat.slice(0, most - 1)}…` : flat
}
