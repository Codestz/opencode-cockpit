/**
 * One subagent, full screen: its whole run as it happens.
 *
 *   ▌⠙ EXPLORE  Map the authentication flow               51s · 6.1k tok · $0.004
 *     launched by build · 14 tools · 2 of 3 subagents
 *
 *     Task
 *     Map how a session is created, read and destroyed in src/auth…
 *
 *     Thinking
 *     Start with the file tree, then session.ts — the name suggests…
 *     ✓ read   src/session.ts                                          0.0s
 *     ⠙ grep   "session" src/auth/**                                running 4s
 *     │ src/auth/session.ts:14: export function createSession(user) {
 *
 *     So far: sessions are created in session.ts:14 and▍
 *
 *   [←→] Other subagent  [m] Message  [t] Hide thinking  [j/k] Scroll  [esc] Back
 *
 * Every row is exactly `width`, and there are exactly `height` of them: the header and the footer
 * keep their place, and only the body scrolls. Pure, like everything in `core/`.
 */

import { type Entry, type Node, type Session, toolTarget } from "../model/model.ts"
import { compact, elapsed, fit, type Row, type Run, spin, spread, widthOf, wrap } from "./rows.ts"

export interface ScreenInput {
  session: Session
  /** Every subagent of the conversation, for "2 of 3" and the switcher. */
  nodes: readonly Node[]
  /** The agent that launched it, for "launched by build". */
  launcher?: string
  width: number
  height: number
  now: number
  frame: number
  /** Body lines scrolled up from the end; 0 follows the run as it grows. */
  up: number
  thinking: boolean
  /** Folded calls shown. */
  expanded: boolean
  /** A line under the keys: what just happened, or why something did not. */
  notice?: string
}

export interface Screen {
  rows: Row[]
  /** How far up the body can scroll, for the keys to clamp against. */
  most: number
}

/** Calls in a row, after which the older ones fold into a count. */
const FOLD_AFTER = 6
/** Lines of a running call's output shown as it streams. */
const TAIL = 6
const PAD = "  "

type Tool = Extract<Entry, { kind: "tool" }>

function toolRow(call: Tool, width: number, now: number, frame: number): Row {
  const glyph: Run =
    call.state === "completed"
      ? { text: "✓", tone: "success" }
      : call.state === "failed"
        ? { text: "✗", tone: "error" }
        : { text: spin(frame), tone: "accent" }
  const time =
    call.state === "completed" || call.state === "failed"
      ? { text: elapsed((call.ended ?? call.at) - call.at), tone: "muted" as const }
      : { text: `running ${elapsed(now - call.at)}`, tone: "accent" as const }
  const name = call.name.padEnd(6)
  return spread(
    [
      { text: PAD },
      glyph,
      { text: ` ${name} `, tone: "tool" },
      { text: toolTarget(call.name, call.input), tone: "text" },
    ],
    [time],
    width,
  )
}

/** A running call's latest output, in the shaded block — the way the shell console streams. */
function tailRows(output: string, width: number): Row[] {
  const lines = output.replace(/\s+$/, "").split("\n").slice(-TAIL)
  return lines.map((line) =>
    fit(
      [
        { text: `${PAD}│ `, tone: "muted", fill: "block" },
        { text: line, tone: "muted", fill: "block" },
      ],
      width,
    ),
  )
}

function textRows(text: string, width: number, run: Omit<Run, "text">): Row[] {
  return wrap(text, width - PAD.length * 2).map((line) => fit([{ text: PAD }, { text: line, ...run }], width))
}

const label = (text: string, width: number, tone: Run["tone"] = "muted"): Row =>
  fit([{ text: PAD }, { text, tone, bold: true }], width)

/** The body: task, then the run in order, folded and filtered as asked. */
function bodyRows(input: ScreenInput): Row[] {
  const { session, width, now, frame } = input
  const rows: Row[] = []
  const blank = () => {
    if (rows.length > 0 && rows.at(-1)?.every((run) => run.text.trim() === "")) return
    rows.push(fit([], width))
  }

  rows.push(label("Task", width))
  rows.push(...textRows(session.task ?? session.title ?? "", width, { tone: "text" }))

  const entries = session.entries.filter((entry) => !(entry.kind === "prompt" && entry.first))
  /** Runs of finished calls longer than FOLD_AFTER keep only their last few, unless expanded. */
  const folded = new Set<Entry>()
  if (!input.expanded) {
    let streak: Tool[] = []
    const close = () => {
      if (streak.length > FOLD_AFTER)
        for (const call of streak.slice(0, streak.length - FOLD_AFTER + 1)) folded.add(call)
      streak = []
    }
    for (const entry of entries) {
      if (entry.kind === "tool" && entry.state === "completed") streak.push(entry)
      else close()
    }
    close()
  }

  let foldedShown = false
  let last: Entry["kind"] | undefined
  for (const entry of entries) {
    if (folded.has(entry)) {
      if (!foldedShown) {
        const count = entries.filter((each) => folded.has(each)).length
        if (last !== "tool") blank()
        rows.push(
          spread(
            [{ text: `${PAD}·  ${count} earlier calls`, tone: "muted" }],
            [{ text: "[e] show all", tone: "muted" }],
            width,
          ),
        )
        foldedShown = true
        last = "tool"
      }
      continue
    }
    switch (entry.kind) {
      case "prompt":
        blank()
        rows.push(label("Message", width, "accent"))
        rows.push(...textRows(entry.text, width, { tone: "text" }))
        break
      case "thinking":
        if (!input.thinking) {
          if (last !== "thinking" && last !== "tool") blank()
          rows.push(fit([{ text: `${PAD}+ Thinking`, tone: "muted", faint: true }], width))
          break
        }
        blank()
        rows.push(fit([{ text: `${PAD}Thinking`, tone: "muted", faint: true }], width))
        rows.push(...textRows(entry.text || "…", width, { tone: "muted", faint: true }))
        break
      case "tool":
        if (last !== "tool" && last !== "thinking") blank()
        else if (last === "thinking" && input.thinking) blank()
        rows.push(toolRow(entry, width, now, frame))
        if ((entry.state === "running" || entry.state === "pending") && entry.output)
          rows.push(...tailRows(entry.output, width))
        if (entry.state === "failed" && entry.error)
          rows.push(...textRows(entry.error, width, { tone: "error" }).slice(0, 3))
        break
      case "reply": {
        blank()
        const lines = textRows(entry.text || "…", width, { tone: "text" })
        if (!entry.done && lines.length > 0) {
          const lastLine = lines[lines.length - 1] as Row
          const text = lastLine
            .map((run) => run.text)
            .join("")
            .trimEnd()
          lines[lines.length - 1] = fit(
            [
              { text, tone: "text" },
              { text: "▍", tone: "accent" },
            ],
            width,
          )
        }
        rows.push(...lines)
        break
      }
    }
    last = entry.kind
  }
  if (session.status === "failed" && session.error) {
    blank()
    rows.push(...textRows(`Failed: ${session.error}`, width, { tone: "error" }))
  }
  return rows
}

function header(input: ScreenInput): Row[] {
  const { session, width, now, frame, nodes } = input
  const running =
    session.status === "running" || session.status === "starting" || session.status === "waiting"
  const glyph: Run =
    session.status === "done"
      ? { text: "✓", tone: "success", fill: "band" }
      : session.status === "failed"
        ? { text: "✗", tone: "error", fill: "band" }
        : { text: spin(frame), tone: "accent", fill: "band" }
  const took = (running ? now : (session.ended ?? now)) - session.started
  const right = [
    elapsed(took),
    session.tokens ? `${compact(session.tokens)} tok` : "",
    session.cost ? `$${session.cost.toFixed(3)}` : "",
  ]
    .filter(Boolean)
    .join(" · ")
  const tools = session.entries.filter((entry) => entry.kind === "tool").length
  const at = nodes.findIndex((node) => node.session.id === session.id)
  const meta = [
    input.launcher ? `launched by ${input.launcher}` : "",
    `${tools} tool${tools === 1 ? "" : "s"}`,
    nodes.length > 1 && at >= 0 ? `${at + 1} of ${nodes.length} subagents` : "",
    session.status === "waiting" ? "waiting for permission" : "",
  ]
    .filter(Boolean)
    .join(" · ")
  return [
    spread(
      [
        { text: "▌", tone: "accent", fill: "band" },
        glyph,
        { text: ` ${session.agent.toUpperCase()} `, tone: "info", bold: true, fill: "band" },
        { text: ` ${session.title || "subagent"}`, tone: "text", fill: "band" },
      ],
      [{ text: `${right} `, tone: "muted", fill: "band" }],
      width,
    ),
    fit([{ text: `${PAD}${meta}`, tone: "muted", fill: "band" }], width),
  ]
}

function footer(input: ScreenInput): Row[] {
  const { width, session } = input
  const key = (k: string, what: string): Run[] => [
    { text: `[${k}]`, tone: "accent" },
    { text: ` ${what}   `, tone: "text" },
  ]
  const keys: Run[] = [
    { text: PAD },
    ...(input.nodes.length > 1 ? key("←→", "Other subagent") : []),
    ...key("m", "Message"),
    ...key("t", input.thinking ? "Hide thinking" : "Show thinking"),
    ...key("j/k", "Scroll"),
    ...key("esc", "Back"),
  ]
  const note =
    input.notice ??
    (session.status === "done" ? "Finished — it will answer a message, but the main agent is not told." : "")
  return [fit(keys, width), fit([{ text: `${PAD}${note}`, tone: "muted" }], width)]
}

export function screenRows(input: ScreenInput): Screen {
  const width = Math.max(20, input.width)
  const height = Math.max(6, input.height)
  const top = header({ ...input, width })
  const bottom = footer({ ...input, width })
  const room = height - top.length - bottom.length - 2
  const body = bodyRows({ ...input, width })
  const most = Math.max(0, body.length - room)
  const up = Math.min(Math.max(0, input.up), most)
  const start = Math.max(0, body.length - room - up)
  const shown = body.slice(start, start + room)
  while (shown.length < room) shown.push(fit([], width))
  return { rows: [...top, fit([], width), ...shown, fit([], width), ...bottom], most }
}

/** For tests and the preview: the columns a row takes. */
export const rowWidth = (row: Row): number => widthOf(row.map((run) => run.text).join(""))
