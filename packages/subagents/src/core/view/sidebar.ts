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
 *   ● general Update README  3 calls · 28s
 *
 * Every row names its agent, muted, before its title; when the row is short the agent shortens
 * first (`expl…`), then the title, and a finished row's numbers give up their calls before the name
 * gets too short to read. With nothing to list the block still says it exists: the heading and
 * `none yet` in the row the first entry will take (client/design `emptyBlock`).
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
  emptyBlock,
  HEADING,
  HEADING_GAP,
  moreText,
  STATE_WORD,
  type State,
  stateMark,
  summaryRuns,
  warnRows,
} from "@opencode-cockpit/client/design"
import {
  type Activity,
  activityOf,
  callsOf,
  type Group,
  groupsOf,
  groupWorking,
  type Node,
  roundsOf,
  runTime,
  type Session,
  titleOf,
  working,
} from "../model/model.ts"
import { cut, elapsed, fit, type Row, type Run, spread, widthOf } from "./rows.ts"

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
  /** Draw nothing at all while there is nothing to list (`hideWhenEmpty`); else `none yet`. */
  hideWhenEmpty?: boolean
  /**
   * Settings to fix, each said once in the block as a `!` row (client/settings `noticeText`). A
   * failure always speaks: with these, the block shows even when `hideWhenEmpty` would hide it.
   */
  notices?: readonly string[]
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
 * The run in a few words — `running 51s`, `done in 2m10s`, `stopped after 4m00s` — as the pane's
 * header and the main agent's tools both say it. The time is its last round's; after more than one,
 * which round it is (`done in 4m00s (round 2)`), and `firstStarted` says when the first began.
 */
export function runPhrase(session: Session, now: number): string {
  const state = stateOf(session)
  const took = elapsed(runTime(session, now))
  const rounds = roundsOf(session)
  const round = rounds > 1 ? ` (round ${rounds})` : ""
  if (state === "waiting") return `waiting ${elapsed(now - session.since)}${round}`
  if (state === "running") return `running ${took}${round}`
  if (state === "done") return `done in ${took}${round}`
  return `${STATE_WORD[state]} after ${took}${round}`
}

/**
 * When a run of more than one round first began — `first started yesterday 22:17` — so a duration
 * that is only the last round's never hides that the subagent goes back further. None for one round.
 */
export function firstStarted(session: Session, now: number): string | undefined {
  if (roundsOf(session) < 2) return undefined
  return `first started ${dayClock(session.started, now)}`
}

/** A time by the clock, by its day: `22:17` today, `yesterday 22:17`, else `2026-09-28 22:17`. */
export function dayClock(at: number, now: number): string {
  const date = new Date(at)
  const pad = (n: number) => String(n).padStart(2, "0")
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  const day = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const today = new Date(now)
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  if (day(date) === day(today)) return time
  if (day(date) === day(yesterday)) return `yesterday ${time}`
  return `${day(date)} ${time}`
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

/** Cells an agent's name keeps once it has started to give way: `exp…`, `gen…`. */
const AGENT_FLOOR = 4

/**
 * Who it is, in at most `room` cells: the agent, muted, then the title. Every row names its agent the
 * same way — `general` too: hiding it to save width made "Write a long plan" and "explore Explore t…"
 * read as two different kinds of thing. The space comes from the agent first: it shortens to
 * `AGENT_FLOOR` before the title loses a letter, because the title is what tells two rows apart.
 */
export function nameRuns(agent: string, title: string, room: number): Run[] {
  const space = Math.max(0, room)
  const whole = widthOf(agent) + 1 + widthOf(title)
  if (whole <= space)
    return [
      { text: `${agent} `, tone: "muted" },
      { text: title, tone: "text" },
    ]
  const floor = Math.min(widthOf(agent), AGENT_FLOOR)
  const shortAgent = cut(agent, Math.max(floor, space - 1 - widthOf(title)))
  const left = space - widthOf(shortAgent) - 1
  /** Too narrow for both: the title alone, as the more telling of the two. */
  if (left < 1) return [{ text: cut(title, space), tone: "text" }]
  return [
    { text: `${shortAgent} `, tone: "muted" },
    { text: cut(title, left), tone: "text" },
  ]
}

/**
 * Columns a finished row keeps for its agent and title before its numbers give way: the agent at its
 * floor, and a title still worth reading.
 */
const TITLE_ROOM = 16

/**
 * Rows a settings notice may wrap to. Its last words are the fix (`run /cockpit-setup`), and at 30
 * columns a long key name alone takes a row: three rows cut the fix off.
 */
const NOTICE_ROWS = 5

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
  if (width < 8) return []
  const title = "Subagents"
  /** Each settings notice once, in the warning tone, wrapped to the column (client/design). */
  const warnings: SidebarLine[] = (input.notices ?? []).flatMap((text) =>
    warnRows(text, width, NOTICE_ROWS).map((row) => ({ row: fit(row, width) })),
  )
  /** Present when empty: the heading and `none yet`, unless asked for silence (and nothing to fix). */
  if (nodes.length === 0) {
    const hide = input.hideWhenEmpty === true && warnings.length === 0
    return [...emptyBlock(title, width, hide).map((row) => ({ row: fit(row, width) })), ...warnings]
  }
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
     * Always its last round, as the pane's header says it. A live entry used to show how long its
     * current step had taken and a finished one its total, so one column meant two things and a run
     * the pane called `running 51s` read `4s` here; then a run continued the next day read `24h04m`
     * for four minutes of work.
     */
    const since = runTime(session, now)
    const calls = callsOf(session)
    /** Continued by the main agent, or messaged by you: each is a round. */
    const rounds = roundsOf(session)
    /** Said in words: a bare "157 · 34m" read as a puzzle. */
    const took = calls > 0 ? `${calls} call${calls === 1 ? "" : "s"} · ${elapsed(since)}` : elapsed(since)
    const count = group.members.length > 1 ? `×${group.members.length}` : ""
    const lead: Row = [{ text: indent }, stateMark(state, frame), { text: " " }]
    const leadWidth = widthOf(indent) + 2
    const title = titleOf(session)
    /** The row's left part: its name in whatever `right` (and the gap before it) leaves. */
    const named = (right: string): Row => [
      ...lead,
      ...nameRuns(session.agent, title, width - leadWidth - (right ? widthOf(right) + 1 : 0)),
    ]

    /**
     * Finished, and nothing under it still working: one row, its numbers on the right and the name in
     * what they leave. After more than one round its time is the last round's, so it says how many
     * rounds. Only when the name would be left less than `TITLE_ROOM` do the numbers give way — the
     * calls first, then the rounds, then the calls of the plain figure; the pane's header says all.
     */
    if (state === "done" && !groupWorking(group)) {
      const tail = count ? `  ${count}` : ""
      const short = elapsed(since)
      const ladder = [
        ...(rounds > 1 ? [`${took} · ${rounds} rounds${tail}`, `${short} · ${rounds} rounds${tail}`] : []),
        `${took}${tail}`,
        `${short}${tail}`,
      ]
      const room = (text: string) => width - leadWidth - widthOf(text) - 1
      const numbers = ladder.find((text) => room(text) >= TITLE_ROOM) ?? `${short}${tail}`
      lines.push({ id, row: spread(named(numbers), [{ text: numbers, tone: "muted" }], width) })
      continue
    }

    lines.push({
      id,
      /** The count stays whole at the edge; the name gives way to it. */
      row: count ? spread(named(count), [{ text: count, tone: "muted" }], width) : fit(named(""), width),
    })
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
  return [...lines, ...warnings]
}
