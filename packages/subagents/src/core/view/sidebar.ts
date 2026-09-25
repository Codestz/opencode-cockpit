/**
 * The sidebar block: a heading with counts, then two lines per subagent — who it is, and what it is
 * doing now. Every line of a subagent carries its id, so a click on either opens it.
 *
 * The sidebar is a narrow column shared with Context, Shells and the statusline; rows are exactly
 * its width, and a subagent's lines stay two however long its task or target is.
 *
 *   Subagents  3 · 2 running · 1 done
 *   ⠙ explore Map the auth flow
 *       grep "session" src/auth/**   51s
 *   ✓ general Update README
 *       done · 3 tools              28s
 */

import { type Activity, activityOf, countsOf, type Node } from "../model/model.ts"
import { elapsed, fit, type Row, type Run, spin, spread } from "./rows.ts"

export interface SidebarLine {
  row: Row
  /** The subagent a click on this line opens. */
  id?: string
}

export interface SidebarInput {
  nodes: readonly Node[]
  width: number
  now: number
  /** The spinner's clock. */
  frame: number
  /** Subagents shown before the rest fold into a count; the sidebar is shared. */
  limit?: number
}

/** The mark before a subagent's name: its state, at a glance. */
function mark(activity: Activity, frame: number): Run {
  switch (activity.kind) {
    case "done":
      return { text: "✓", tone: "success" }
    case "failed":
      return { text: "✗", tone: "error" }
    case "waiting":
      return { text: "⏸", tone: "muted" }
    default:
      return { text: spin(frame), tone: "accent" }
  }
}

/** The second line: the current call and its target, or thinking/writing/waiting/done/failed. */
function doing(activity: Activity): Row {
  switch (activity.kind) {
    case "tool":
      return [
        { text: `${activity.tool ?? "tool"} `, tone: "tool" },
        { text: activity.text, tone: "text" },
      ]
    case "failed":
      return [{ text: `failed: ${activity.text}`, tone: "error" }]
    case "done":
      return [{ text: `done · ${activity.text}`, tone: "muted" }]
    default:
      return [{ text: activity.text, tone: "muted" }]
  }
}

export function sidebarLines(input: SidebarInput): SidebarLine[] {
  const { nodes, width, now, frame } = input
  /** Silence is the rule: no subagents, no block. */
  if (nodes.length === 0 || width < 8) return []
  const counts = countsOf(nodes)
  const summary = [
    `${counts.total}`,
    counts.running ? `${counts.running} running` : "",
    counts.done ? `${counts.done} done` : "",
    counts.failed ? `${counts.failed} failed` : "",
  ]
    .filter(Boolean)
    .join(" · ")
  const lines: SidebarLine[] = [
    {
      row: fit(
        [
          { text: "Subagents", tone: "text", bold: true },
          { text: `  ${summary}`, tone: "muted" },
        ],
        width,
      ),
    },
  ]

  /** Working ones first, so the one you are wondering about is never folded away. */
  const limit = Math.max(1, input.limit ?? 6)
  const active = nodes.filter((node) => node.session.status !== "done" && node.session.status !== "failed")
  const shown =
    active.length >= limit
      ? active.slice(0, limit)
      : [...active, ...nodes.filter((node) => !active.includes(node)).slice(-(limit - active.length))]
  const visible = nodes.filter((node) => shown.includes(node))

  for (const { session, depth } of visible) {
    const activity = activityOf(session)
    const indent = "  ".repeat(Math.min(depth, 3))
    const id = session.id
    lines.push({
      id,
      row: fit(
        [
          { text: indent },
          mark(activity, frame),
          { text: ` ${session.agent} `, tone: "info" },
          { text: session.title || session.task || "subagent", tone: "text" },
        ],
        width,
      ),
    })
    const since =
      activity.kind === "done" || activity.kind === "failed"
        ? (session.ended ?? now) - session.started
        : now - activity.since
    lines.push({
      id,
      row: spread(
        [{ text: `${indent}    ` }, ...doing(activity)],
        [{ text: elapsed(since), tone: "muted" }],
        width,
      ),
    })
  }

  const hidden = nodes.length - visible.length
  if (hidden > 0) lines.push({ row: fit([{ text: `  + ${hidden} more`, tone: "muted" }], width) })
  return lines
}
