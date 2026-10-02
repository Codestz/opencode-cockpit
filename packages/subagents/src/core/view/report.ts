/**
 * The main agent's view of its subagents: what `subagents_list`, `subagents_read` and `subagents_wait`
 * answer.
 *
 * Written for a model, not a person — plain lines, every id in full, and the one thing it needs to do
 * with them said once: continue a subagent by its id rather than start a new one, so the follow-up
 * keeps everything that subagent already read and tried. Every time is given as "ago" *and* as a clock
 * time beside the current one: a model has no clock, and in a conversation reopened the next day it
 * read "finished 24h13m ago" as a bug. Pure, like everything in `core/`.
 */

import { type Entry, type Node, type Session, toolTarget } from "../model/model.ts"
import { continueHow } from "./guidance.ts"
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
  const lines = [
    `Subagents of this conversation, oldest first (now: ${clock(now, now, true)}). To follow up on work one of them did, continue that same subagent — ${continueHow(version)} — instead of launching a new one: it keeps everything it already read and tried. subagents_read gives one's full answer and what it did.`,
    "",
  ]
  for (const { session, depth } of nodes) {
    const calls = session.entries.filter((entry) => entry.kind === "tool").length
    const rounds = session.entries.filter((entry) => entry.kind === "prompt").length
    const indent = "  ".repeat(depth)
    lines.push(
      `${indent}- ${session.id} · ${session.agent} · "${session.title || "subagent"}" · ${stateOf(session, now).text} · ${calls} call${calls === 1 ? "" : "s"}${rounds > 1 ? ` · ${rounds} rounds` : ""}${session.background ? " · background" : ""}`,
    )
    if (session.task) lines.push(`${indent}  Task: ${clip(session.task, ANSWER)}`)
    const answer = lastAnswer(session.entries)
    if (answer)
      lines.push(
        answered(session)
          ? `${indent}  Last answer: ${clip(answer, ANSWER)}`
          : `${indent}  Last words (a progress note, not its answer): ${clip(answer, ANSWER)}`,
      )
  }
  return lines.join("\n")
}

// ---------------------------------------------------------------------------------------------------
// One subagent's state, in words

export type StateKind = "working" | "waiting" | "finished" | "ended" | "cancelled" | "failed"

export interface State {
  kind: StateKind
  /** Whether it has stopped: nothing more will come from it until it is asked again. */
  over: boolean
  text: string
}

/** Stopped from outside: OpenCode 1 says "aborted", OpenCode 2 "interrupted". */
export const cancelledError = (error: string | undefined): boolean =>
  /abort|interrupt|cancel/i.test(error ?? "")

export function stateOf(session: Session, now: number): State {
  const at = session.ended ?? now
  const when = `${elapsed(now - at)} ago (${clock(at, now)})`
  const worked = workedFor(session)
  const forHow = worked > 0 ? ` after ${elapsed(worked)} of work` : ""
  const said = answered(session)
  if (session.status === "failed" && cancelledError(session.error))
    return {
      kind: "cancelled",
      over: true,
      text: `cancelled ${when}${forHow} — stopped before it finished${said ? "" : ", no final answer"}`,
    }
  if (session.status === "failed")
    return {
      kind: "failed",
      over: true,
      text: `failed ${when}${forHow}${session.error ? ` (${clip(session.error, 200)})` : ""}`,
    }
  /** Idle before it did anything is finished, not working: nothing is coming from it. */
  const ended = session.status === "done" || (session.status === "starting" && session.ended !== undefined)
  if (ended) {
    if (said) return { kind: "finished", over: true, text: `finished ${when}${forHow}` }
    const never = sinceLastPrompt(session.entries).length === 0
    return {
      kind: "ended",
      over: true,
      text: `ended ${when} without a final answer${never ? " (it never started on its task)" : ""}`,
    }
  }
  if (session.status === "waiting")
    return {
      kind: "waiting",
      over: false,
      text: `waiting ${elapsed(now - session.since)} for a permission or question only the user can answer`,
    }
  const quiet = now - session.seen
  return {
    kind: "working",
    over: false,
    text: `working now, for ${elapsed(now - roundStart(session))}${quiet >= 60_000 ? `, nothing heard for ${elapsed(quiet)}` : ""}`,
  }
}

/** What to tell the agent about continuing one that stopped early. */
export function continueNote(session: Session, version: 1 | 2): string | undefined {
  const { kind } = stateOf(session, session.ended ?? session.seen)
  if (kind !== "cancelled" && kind !== "failed" && kind !== "ended") return undefined
  return `It can be continued — ${continueHow(version)} "${session.id}" — and keeps what it already did; tell it what is left rather than repeating the whole task.`
}

/** It ended on words, after it was last asked something: an answer, not a note before a call. */
export function answered(session: Session): boolean {
  const tail = sinceLastPrompt(session.entries).at(-1)
  return tail?.kind === "reply" && tail.text.trim() !== ""
}

/** When its current round began: the last thing it was asked, or when it started. */
function roundStart(session: Session): number {
  const prompt = session.entries[lastPrompt(session.entries)]
  return prompt?.at ?? session.started
}

/** How long its last round ran before it ended; 0 while it still runs, or when unknown. */
function workedFor(session: Session): number {
  if (session.ended === undefined) return 0
  return Math.max(0, session.ended - roundStart(session))
}

export function lastPrompt(entries: readonly Entry[]): number {
  for (let i = entries.length - 1; i >= 0; i--) if (entries[i]?.kind === "prompt") return i
  return -1
}

function sinceLastPrompt(entries: readonly Entry[]): Entry[] {
  return entries.slice(lastPrompt(entries) + 1)
}

export function lastAnswer(entries: readonly Entry[]): string | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]
    if (entry?.kind === "reply" && entry.text.trim()) return entry.text
  }
  return undefined
}

// ---------------------------------------------------------------------------------------------------
// subagents_read

/** How much of the run one read lists, and how much of a final answer it repeats. */
export const READ_BUDGET = 6_000
export const ANSWER_MOST = 12_000

export interface AccountInput {
  session: Session
  /** Its own subagents, as `subagentsOf` gives them under it. */
  children: readonly Node[]
  now: number
  version: 1 | 2
  /** The cursor from a previous read: entries after it. */
  after?: number
  budget?: number
}

/**
 * One subagent in full, for `subagents_read`: its state, its task, its final answer whole, and its run
 * as one line per thing it did — the calls with what they were about and how they ended, what it was
 * told, what it said — paged with a cursor, as `shell_read` pages output.
 */
export function subagentAccount({
  session,
  children,
  now,
  version,
  after = 0,
  budget = READ_BUDGET,
}: AccountInput): string {
  const state = stateOf(session, now)
  const tools = session.entries.filter(
    (entry): entry is Extract<Entry, { kind: "tool" }> => entry.kind === "tool",
  )
  const failed = tools.filter((tool) => tool.state === "failed").length
  const rounds = session.entries.filter((entry) => entry.kind === "prompt").length
  const out = [
    `<subagent id="${session.id}" agent="${session.agent}" title="${session.title || "subagent"}">`,
    `State: ${state.text} (now: ${clock(now, now, true)})`,
  ]
  if (after === 0) {
    out.push(
      `Calls: ${tools.length}${failed > 0 ? ` (${failed} failed)` : ""} · ${rounds} round${rounds === 1 ? "" : "s"}${session.background ? " · background" : ""}`,
    )
    if (children.length > 0)
      out.push(
        `Its own subagents: ${children
          .filter((node) => node.session.parentID === session.id)
          .map(
            (node) =>
              `${node.session.id} "${node.session.title || "subagent"}" (${stateOf(node.session, now).kind})`,
          )
          .join(", ")}`,
      )
    if (session.task) out.push("Task:", clip(session.task, 4_000, false))
    const answer = lastAnswer(session.entries)
    if (answered(session) && answer) out.push("Final answer:", clip(answer, ANSWER_MOST, false))
    else if (answer)
      out.push(
        `No final answer${state.over ? "" : " yet"}. Its last words (a progress note): ${clip(answer, 600)}`,
      )
    else out.push(`No final answer${state.over ? "" : " yet"}, and nothing said.`)
  }
  const entries = session.entries.filter((entry) => entry.kind !== "thinking")
  const final = answered(session) ? lastReplyIndex(entries) : -1
  const lines: string[] = []
  let used = 0
  let shown = after
  for (let i = after; i < entries.length; i++) {
    const line = `${i + 1}. ${entryLine(entries[i] as Entry, i === final, now)}`
    if (used + line.length > budget && lines.length > 0) break
    lines.push(line)
    used += line.length + 1
    shown = i + 1
  }
  if (entries.length === 0) out.push("Run: nothing recorded.")
  else if (lines.length === 0) out.push(`Run: nothing after ${after} (it has ${entries.length} entries).`)
  else out.push(`Run, entries ${after + 1}–${shown} of ${entries.length}:`, ...lines)
  out.push("</subagent>")
  if (shown < entries.length) out.push(`More: subagents_read id=${session.id} after=${shown}`)
  else out.push(`cursor: ${shown}`)
  const note = continueNote(session, version)
  if (note) out.push(note)
  return out.join("\n")
}

function lastReplyIndex(entries: readonly Entry[]): number {
  for (let i = entries.length - 1; i >= 0; i--) if (entries[i]?.kind === "reply") return i
  return -1
}

function entryLine(entry: Entry, final: boolean, now: number): string {
  const at = clock(entry.at, now)
  switch (entry.kind) {
    case "prompt":
      return `${at} ${entry.first ? "given its task" : `told: ${clip(entry.text, 300)}`}`
    case "reply":
      return final ? `${at} answered (the final answer, above)` : `${at} said: ${clip(entry.text, 300)}`
    case "thinking":
      return `${at} thought`
    case "tool": {
      const target = clip(toolTarget(entry.name, entry.input), 120)
      const outcome =
        entry.state === "failed"
          ? `FAILED${entry.error ? `: ${clip(entry.error, 200)}` : ""}`
          : entry.state === "completed"
            ? `ok${entry.summary ? ` (${entry.summary})` : ""}`
            : "still running"
      return `${at} ${entry.name}${target ? ` ${target}` : ""} — ${outcome}`
    }
  }
}

// ---------------------------------------------------------------------------------------------------
// subagents_wait

export interface WaitInput {
  sessions: readonly Session[]
  now: number
  version: 1 | 2
  /** How long it waited, and whether it gave up before all were over. */
  waited: number
  timedOut: boolean
  cancelled?: boolean
}

export function waitReport({ sessions, now, version, waited, timedOut, cancelled }: WaitInput): string {
  const head = cancelled
    ? `Wait cancelled after ${elapsed(waited)}.`
    : timedOut
      ? `Timed out after ${elapsed(waited)}; some are still working. Wait again, or carry on and you will be told when a background one finishes.`
      : `Waited ${elapsed(waited)}.`
  const lines = [head]
  for (const session of sessions) {
    const state = stateOf(session, now)
    lines.push(`- ${session.id} · "${session.title || "subagent"}" · ${state.text}`)
    const answer = lastAnswer(session.entries)
    if (state.over && answer)
      lines.push(
        answered(session)
          ? `  Answer: ${clip(answer, 800)}${answer.length > 800 ? ` (whole: subagents_read id=${session.id})` : ""}`
          : `  Last words (not an answer): ${clip(answer, 400)}`,
      )
    const note = continueNote(session, version)
    if (note) lines.push(`  ${note}`)
  }
  return lines.join("\n")
}

// ---------------------------------------------------------------------------------------------------

/** A time as a clock: `22:31` today, `2026-09-30 22:20` on another day; `full` always dates it. */
export function clock(at: number, now: number, full = false): string {
  const date = new Date(at)
  const pad = (n: number) => String(n).padStart(2, "0")
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const today = new Date(now)
  const same =
    today.getFullYear() === date.getFullYear() &&
    today.getMonth() === date.getMonth() &&
    today.getDate() === date.getDate()
  return full || !same ? `${day} ${time}` : time
}

const clip = (text: string, most: number, flatten = true): string => {
  const flat = flatten ? text.replace(/\s+/g, " ").trim() : text.trim()
  return flat.length > most ? `${flat.slice(0, most - 1)}… (${flat.length - most + 1} more characters)` : flat
}
