/**
 * The sidebar block: a heading with counts, then two lines per entry — who it is, and what it is
 * doing now. Every line of an entry carries the id it opens, so a click on either opens it.
 *
 * The sidebar is a narrow column shared with Context, Shells and the statusline; rows are exactly
 * its width, and an entry's lines stay two however long its task or target is.
 *
 *   Subagents                   2 running
 *   ⠙ explore Map the auth flow
 *     └ grep "session"  9 calls · 51s
 *     ⠙ advisor Review the plan      ×6
 *       └ 2 running · thinking    3s
 *   ● general Update README
 *     └ done            3 calls · 28s
 *
 * Working entries come first at every level, and children stay under their parent. Subagents with
 * the same parent, agent and task are one entry with a count (`×6`), which is not the same thing as
 * rounds (`· 2 rounds`): rounds are prompts within one session, `×N` is N sessions.
 */

import {
  type Activity,
  activityOf,
  countsOf,
  type Group,
  groupsOf,
  groupWorking,
  type Node,
  working,
} from "../model/model.ts"
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
  /** Entries shown before the rest fold into a count; the sidebar is shared. */
  limit?: number
  /**
   * Milliseconds a finished *nested* entry stays after it ended; unset keeps it. A subagent's own
   * helpers are short-lived and many, and once done they say nothing the entry above them does not.
   * They only leave the sidebar: the heading still counts them, and the pane still reaches them.
   */
  fadeAfter?: number
}

/** The mark before a subagent's name: its state, at a glance. */
function mark(activity: Activity, frame: number): Run {
  switch (activity.kind) {
    /** A dot, coloured by how it ended — a check mark drew as a thin "√" in many terminal fonts. */
    case "done":
      return { text: "●", tone: "success" }
    case "failed":
      return { text: "●", tone: "error" }
    case "waiting":
      return { text: "○", tone: "warning" }
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
      /** Stopped — by you, or with the main agent — is not broken. */
      return /abort|interrupt|cancel/i.test(activity.text)
        ? [{ text: "cancelled", tone: "warning" }]
        : [{ text: `failed: ${activity.text}`, tone: "error" }]
    case "done":
      return [{ text: "done", tone: "success" }]
    default:
      return [{ text: activity.text, tone: "muted" }]
  }
}

/** When the last of a group's members ended. */
const endedAt = (group: Group): number => Math.max(...group.members.map((s) => s.ended ?? s.started))

/** An entry and where it sits: its parent, so a shown entry can bring its parent with it. */
interface Placed {
  group: Group
  parent?: Placed
}

/**
 * The entries still shown, depth first. A nested entry leaves once it, and everything under it, has
 * been finished for `fadeAfter`; a top-level one never does here (`hideFinishedAfter` is the host's).
 */
function place(groups: readonly Group[], now: number, fadeAfter: number | undefined): Placed[] {
  const out: Placed[] = []
  const gone = (group: Group): boolean =>
    fadeAfter !== undefined &&
    group.depth >= 1 &&
    !groupWorking(group) &&
    now - endedAt(group) >= fadeAfter &&
    group.children.every(gone)
  const walk = (level: readonly Group[], parent: Placed | undefined) => {
    for (const group of level) {
      if (gone(group)) continue
      const placed: Placed = { group, ...(parent ? { parent } : {}) }
      out.push(placed)
      walk(group.children, placed)
    }
  }
  walk(groups, undefined)
  return out
}

export function sidebarLines(input: SidebarInput): SidebarLine[] {
  const { nodes, width, now, frame } = input
  /** Silence is the rule: no subagents, no block. */
  if (nodes.length === 0 || width < 8) return []
  /** Every subagent, faded and grouped ones included: the heading counts sessions, not rows. */
  const counts = countsOf(nodes)
  /** What needs your eye: how many are working, else how it ended. */
  const summary = counts.running
    ? `${counts.running} running`
    : counts.failed
      ? `${counts.failed} failed`
      : `${counts.done} done`
  const lines: SidebarLine[] = [
    {
      row: spread(
        [{ text: "Subagents", tone: "text", bold: true }],
        [{ text: summary, tone: counts.running ? "accent" : counts.failed ? "error" : "muted" }],
        width,
      ),
    },
  ]

  /**
   * Working ones first, so the one you are wondering about is never folded away; then the latest
   * finished. A shown entry brings its parents, so nothing is drawn indented under nothing.
   */
  const placed = place(groupsOf(nodes), now, input.fadeAfter)
  const limit = Math.max(1, input.limit ?? 6)
  /** Its own members working — not one that is done with a child at it, which comes as a parent. */
  const active = placed.filter((entry) => entry.group.members.some(working))
  const finished = placed.filter((entry) => !entry.group.members.some(working))
  const chosen = new Set(
    active.length >= limit
      ? active.slice(0, limit)
      : [...active, ...finished.slice(Math.max(0, finished.length - (limit - active.length)))],
  )
  for (const entry of [...chosen]) for (let up = entry.parent; up; up = up.parent) chosen.add(up)
  const visible = placed.filter((entry) => chosen.has(entry))

  for (const { group } of visible) {
    const session = group.lead
    const activity = activityOf(session)
    const indent = "  ".repeat(Math.min(group.depth, 3))
    const id = session.id
    const name: Row = [
      { text: indent },
      mark(activity, frame),
      { text: ` ${session.agent} `, tone: "info" },
      { text: session.title || session.task || "subagent", tone: "text" },
    ]
    lines.push({
      id,
      /** The count stays whole at the edge; the task gives way to it. */
      row:
        group.members.length > 1
          ? spread(name, [{ text: `×${group.members.length}`, tone: "muted" }], width)
          : fit(name, width),
    })
    const since =
      activity.kind === "done" || activity.kind === "failed"
        ? (session.ended ?? now) - session.started
        : now - activity.since
    const calls = session.entries.filter((entry) => entry.kind === "tool").length
    /** Continued by the main agent, or messaged by you: each is a round. */
    const rounds = session.entries.filter((entry) => entry.kind === "prompt").length
    /**
     * The line describes one member; when more than one is at it, it says so — first, where the
     * target cannot cut it off, or the heading's "3 running" would not add up to the spinners shown.
     */
    const alongside = group.members.filter(working).length
    lines.push({
      id,
      row: spread(
        [
          { text: `${indent}  └ `, tone: "border" },
          ...(alongside > 1 ? [{ text: `${alongside} running · `, tone: "muted" as const }] : []),
          ...doing(activity),
          ...(rounds > 1 ? [{ text: ` · ${rounds} rounds`, tone: "muted" as const }] : []),
        ],
        /** Right-aligned, so the target gives way and the numbers stay whole. */
        /** Said in words: a bare "157 · 34m" read as a puzzle. */
        [
          {
            text: calls > 0 ? `${calls} call${calls === 1 ? "" : "s"} · ${elapsed(since)}` : elapsed(since),
            tone: "muted",
          },
        ],
        width,
      ),
    })
  }

  /** Subagents, not entries: the same unit the heading counts. Faded ones are not "more". */
  const hidden = placed
    .filter((entry) => !chosen.has(entry))
    .reduce((sum, entry) => sum + entry.group.members.length, 0)
  if (hidden > 0) lines.push({ row: fit([{ text: `  + ${hidden} more`, tone: "muted" }], width) })
  return lines
}
