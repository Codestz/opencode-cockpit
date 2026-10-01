/**
 * The sidebar block: a heading with counts, then two lines per entry — who it is, and what it is
 * doing now. Every line of an entry carries the id it opens, so a click on either opens it.
 *
 * The sidebar is a narrow column shared with Context, Shells and the statusline; rows are exactly
 * its width, and an entry's lines stay two however long its task or target is.
 *
 *   Subagents         2 running · 1 done
 *   ⠙ explore Map the auth flow
 *     └ grep "session"  9 calls · 51s
 *     ⠙ advisor Review the plan      ×6
 *       └ 2 running · thinking    3s
 *   ● Update README       3 calls · 28s
 *
 * A finished entry is one row: there is nothing it is doing, and a second row saying `done` under
 * every one of seven finished subagents was what pushed the rest under `+ 3 more`. What is still
 * doing something — running, waiting on you, failed, stopped — keeps the row that says what.
 *
 * Working entries come first at every level, and children stay under their parent. Subagents with
 * the same parent, agent and task are one entry with a count (`×6`), which is not the same thing as
 * rounds (`· 2 rounds`): rounds are prompts within one session, `×N` is N sessions.
 */

import {
  HEADING,
  HEADING_GAP,
  moreText,
  STATE_WORD,
  type State,
  stateMark,
  summaryRuns,
} from "@opencode-cockpit/client/design"
import {
  type Activity,
  activityOf,
  type Group,
  groupsOf,
  groupWorking,
  type Node,
  type Session,
  working,
} from "../model/model.ts"
import { elapsed, fit, type Row, type Run, spread } from "./rows.ts"

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

/** Stopped — by you, or with the main agent — is not broken: OpenCode reports it as an error. */
export const stoppedOn = (error: string | undefined): boolean => /abort|interrupt|cancel/i.test(error ?? "")

/** A session in the words every bay shares (client/design), so it wears the same tone and mark. */
export function stateOf(session: Session): State {
  if (session.status === "waiting") return "waiting"
  if (session.status === "failed") return stoppedOn(session.error) ? "stopped" : "failed"
  if (session.status === "done") return "done"
  return "running"
}

/**
 * The second line: the current call and its target, or thinking/writing/waiting/failed/stopped. A
 * finished one has none.
 */
function doing(activity: Activity): Row {
  switch (activity.kind) {
    case "tool":
      return [
        { text: `${activity.tool ?? "tool"} `, tone: "tool" },
        { text: activity.text, tone: "text" },
      ]
    case "failed":
      /** One event, one state: it was drawn red, worded orange and counted as failed in the heading. */
      return stoppedOn(activity.text)
        ? [{ text: STATE_WORD.stopped, tone: "muted" }]
        : [{ text: `failed: ${activity.text}`, tone: "error" }]
    case "done":
      return [{ text: STATE_WORD.done, tone: "muted" }]
    /** The one line that needs you: drawn in the tone of its mark, not muted like an idle one. */
    case "waiting":
      return [{ text: activity.text, tone: "warning" }]
    default:
      return [{ text: activity.text, tone: "muted" }]
  }
}

/**
 * The agent's name, when it says something. `general` is what a subagent is when nobody chose one,
 * and on every row it cost eight columns the title needed; the pane's header still names it. Any
 * other agent is named, muted — it qualifies the title rather than competing with it.
 */
const agentRun = (agent: string): Run[] => (agent === "general" ? [] : [{ text: `${agent} `, tone: "muted" }])

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
  /**
   * Every subagent, faded and grouped ones included: the heading counts sessions, not rows. Every
   * state there is, not only the worst — `1 failed` sat over six done ones — in the words and order
   * every block's heading uses (client/design); narrow, history gives way and what needs you stays.
   */
  const counts: Partial<Record<State, number>> = {}
  for (const node of nodes) {
    const state = stateOf(node.session)
    counts[state] = (counts[state] ?? 0) + 1
  }
  const title = "Subagents"
  const summary: Run[] = summaryRuns(counts, width - title.length - 1)
  const lines: SidebarLine[] = [
    { row: spread([{ text: title, ...HEADING }], summary, width) },
    ...Array.from({ length: HEADING_GAP }, (): SidebarLine => ({ row: spread([], [], width) })),
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
    const state = stateOf(session)
    const indent = "  ".repeat(Math.min(group.depth, 3))
    const id = session.id
    /**
     * Always the whole run, as the pane's header says it. A live entry used to show how long its
     * current step had taken and a finished one its total, so one column meant two things and a run
     * the pane called `running 51s` read `4s` here.
     */
    const since = (working(session) ? now : (session.ended ?? now)) - session.started
    const calls = session.entries.filter((entry) => entry.kind === "tool").length
    /** Said in words: a bare "157 · 34m" read as a puzzle. */
    const took = calls > 0 ? `${calls} call${calls === 1 ? "" : "s"} · ${elapsed(since)}` : elapsed(since)
    const count = group.members.length > 1 ? `×${group.members.length}` : ""
    const name: Row = [
      { text: indent },
      stateMark(state, frame),
      { text: " " },
      ...agentRun(session.agent),
      { text: session.title || session.task || "subagent", tone: "text" },
    ]

    /** Finished, and nothing under it still working: one row, its numbers on the right. */
    if (state === "done" && !groupWorking(group)) {
      lines.push({
        id,
        row: spread(name, [{ text: count ? `${took}  ${count}` : took, tone: "muted" }], width),
      })
      continue
    }

    lines.push({
      id,
      /** The count stays whole at the edge; the task gives way to it. */
      row: count ? spread(name, [{ text: count, tone: "muted" }], width) : fit(name, width),
    })
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
        [{ text: took, tone: "muted" }],
        width,
      ),
    })
  }

  /** Subagents, not entries: the same unit the heading counts. Faded ones are not "more". */
  const hidden = placed
    .filter((entry) => !chosen.has(entry))
    .reduce((sum, entry) => sum + entry.group.members.length, 0)
  if (hidden > 0) lines.push({ row: fit([{ text: `  ${moreText(hidden)}`, tone: "muted" }], width) })
  return lines
}
