/**
 * The activity, behind `a` in the ledger: what Trust did for you, newest first, then what it is about
 * to do.
 *
 *    Trust · opencode-cockpit · activity                                        ● answering
 *
 *    TODAY  Trust answered 4 prompts for you                       ▁▁▃▁▅▂█  last 7 days
 *   ▌✓ 09:41  git status --short       build     trusted since yesterday, 3 in a row
 *    ✓ 09:40  ls -la                   general   in a family you widened: ls
 *
 *    ALMOST THERE  one more approval and Trust answers these
 *    ○        bun --version            build     ▰▰▱       2 of 3
 *    ○        git push origin feat/…   build     ▰▰▰▰▰▱▱▱  5 of 8   dangerous
 *
 *    ! WATCH OUT   OpenCode's own "always" approves more than it looks, until it restarts
 *    !        find *  sed *            general   [enter] what it covers
 *
 *    RULES  11 trusted · 14 learning · 101 seen once                      l  Open the ledger
 *
 *    [enter] Why   [x] Revoke   [w] Trust Family   [a] Ledger   [p] Pause   [?] Keys   [esc] Back
 *
 * One left edge: every row starts with its mark (`✓` answered, `○` close, `!` OpenCode's own), then
 * the time column, then the command, so the three lists read as one. The agent has a column only
 * when there is more than one; with one, the header names it and its chip is not repeated on every
 * row. Paths are cut in the middle (`rows.squeeze`), so the file each command touched stays visible.
 *
 * The ledger (explorer.ts) is what `/trust` opens on; this is the "what happened" view, reached from
 * its Today strip or `a`. Every list is a window that follows the cursor, so a short dialog still
 * reaches everything.
 */

import { closeHint, type Hint } from "@opencode-cockpit/client/design"
import { showSubject } from "../family.ts"
import { type Answer, answersPerDay, dayOf, earned, type History, latestAnswers } from "../history.ts"
import { keyOf, needFor } from "../ledger.ts"
import { revokeLabel, type Target, widenLabel, widenScope } from "./actions.ts"
import {
  type AlwaysGroup,
  alwaysGroups,
  type Command,
  type Counts,
  commandsOf,
  countsOf,
  type Family,
  familiesOf,
  leadOf,
  type Reading,
} from "./model.ts"
import {
  badge,
  button,
  buttonHits,
  chip,
  clock,
  dayWord,
  footerRow,
  type Hit,
  headerRow,
  type KeyLine,
  keyListBody,
  meter,
  muted,
  plain,
  since,
  sparkline,
  wrapRuns,
} from "./parts.ts"
import { cursorRow, fit, type Row, type Run, spread, squeeze, widthOf } from "./rows.ts"

export type ActivityItem =
  /** An answer Trust gave; `count` answers of the same line in a row are one item. */
  | { kind: "answer"; key: string; answer: Answer; count: number }
  | { kind: "almost"; key: string; command: Command }
  | { kind: "always"; key: string; group: AlwaysGroup }

export interface ActivityModel {
  /** Every item the cursor moves over, in screen order. */
  items: ActivityItem[]
  feed: ActivityItem[]
  almost: ActivityItem[]
  always: ActivityItem[]
  /** Answers today; when there are none, the feed is the latest from earlier days. */
  today: number
  week: number[]
  counts: Counts
  commands: Command[]
  families: Family[]
}

/** Answers the feed holds: far more than a screen shows, for the cursor to scroll through. */
const FEED_MAX = 60

/** What was answered, as the other lists say it: `edit src/app.ts`, `webfetch …`, a command bare. */
const labelOf = (answer: Answer) =>
  `${answer.permission === "bash" ? "" : `${answer.permission} `}${answer.items
    .map((item) => showSubject(answer.permission, item.subject))
    .join(" && ")}`

export function activityModel(input: Reading & { history: History }): ActivityModel {
  const { history, now } = input
  const commands = commandsOf(input)
  const families = familiesOf(input, commands)
  const latest = latestAnswers(history, FEED_MAX * 4)
  const todays = latest.filter((answer) => dayOf(answer.at) === dayOf(now))
  const feed: ActivityItem[] = []
  for (const answer of todays.length > 0 ? todays : latest) {
    const last = feed.at(-1)
    /** The same line answered again and again is one row with a count, not a wall of it. */
    if (
      last?.kind === "answer" &&
      last.answer.agent === answer.agent &&
      last.answer.permission === answer.permission &&
      labelOf(last.answer) === labelOf(answer)
    ) {
      last.count++
      continue
    }
    if (feed.length >= FEED_MAX) break
    feed.push({ kind: "answer", key: `a:${answer.request}`, answer, count: 1 })
  }
  const almost: ActivityItem[] = commands
    .filter((command) => command.phase === "learning")
    .sort(
      (a, b) =>
        Number(a.danger !== undefined) - Number(b.danger !== undefined) ||
        distanceOf(a) - distanceOf(b) ||
        b.lastAt - a.lastAt,
    )
    .map((command) => ({ kind: "almost", key: `c:${command.key}`, command }))
  const always: ActivityItem[] = alwaysGroups(input.state).map((group) => ({
    kind: "always",
    key: `o:${group.key}`,
    group,
  }))
  return {
    items: [...feed, ...almost, ...always],
    feed,
    almost,
    always,
    today: todays.length,
    week: answersPerDay(history, now, 7),
    counts: countsOf(commands),
    commands,
    families,
  }
}

/** Approvals still to go for the agent closest to trusting it. */
function distanceOf(command: Command): number {
  const { stand } = leadOf(command)
  return stand.kind === "counting" ? (stand.expired ? Number.MAX_SAFE_INTEGER : stand.need - stand.have) : 0
}

/** What the cursor's item is, for `x`, `w` and `c`. */
export function targetOf(item: ActivityItem, model: ActivityModel): Target {
  if (item.kind === "answer") return { kind: "answer", answer: item.answer }
  if (item.kind === "always") return { kind: "always", groups: [item.group] }
  const family = model.families.find(
    (each) => each.permission === item.command.permission && each.family === item.command.family,
  )
  return family
    ? { kind: "command", command: item.command, family }
    : { kind: "command", command: item.command }
}

/* ─── why it answered ────────────────────────────────────────────────────────────────────────── */

/** `9h ago`, `since yesterday`, `since Tue`. */
function trustedWhen(at: number, now: number): string {
  const day = dayWord(at, now)
  if (day === "today") return `${since(now - at)} ago`.replace(/^now ago$/, "just now")
  return `since ${day.replace(/^on /, "")}`
}

/**
 * Why Trust answered, in a few muted words: the approvals that earned it and when, or the family you
 * widened. Read from the rule's own moments (history.ts); when the window no longer reaches back that
 * far, the reason the answering window logged.
 */
export function answerWhy(answer: Answer, reading: Reading & { history: History }): string {
  const { settings, now, history } = reading
  const widened = answer.items.filter((item) => item.via !== undefined)
  const count = answer.items.length
  if (count > 1) {
    if (widened.length === 0) return count === 2 ? "both commands trusted" : `all ${count} commands trusted`
    if (count === 2)
      return widened.length === 2
        ? "both through families you widened"
        : "both trusted, one through a family you widened"
    return `all ${count} trusted, ${widened.length} through a family you widened`
  }
  const item = answer.items[0]
  if (!item) return answer.rule
  if (item.via !== undefined) return `in a family you widened: ${showSubject(answer.permission, item.via)}`
  const marks = history.marks.get(keyOf(answer.permission, answer.agent, item.subject)) ?? []
  const need = needFor(item.danger, settings)
  const got = earned(marks, need, settings.expireDays * 86_400_000, answer.at)
  if (got.since === undefined) return answer.rule
  return `trusted ${trustedWhen(got.since, now)}, ${got.streak} in a row${item.danger ? " · dangerous" : ""}`
}

/* ─── drawing ────────────────────────────────────────────────────────────────────────────────── */

export interface ActivityInput extends Reading {
  width: number
  height: number
  history: History
  /** The project's folder name, for the header. */
  project: string
  /** The key of the item under the cursor; the first item when it is not there. */
  selected?: string
  notice?: { text: string; tone: Run["tone"] }
  /** `?`: every key, in the body's place. */
  keys?: boolean
}

export interface ActivityView {
  rows: Row[]
  /** The item under the cursor, as drawn: the caller's actions act on it. */
  item?: ActivityItem
  model: ActivityModel
  /** Where a click lands: a row selects, the ledger button opens the ledger. */
  hits: Hit[]
}

/** The shortest dialog drawn: a header, a little of each list, the rules line and a way out. */
export const MIN_HEIGHT = 11

export const ACTIVITY_KEYS: readonly KeyLine[] = [
  { keys: ["j/k", "↑/↓"], does: "Move between answers, rules close to trusted and OpenCode's own approvals" },
  { keys: ["enter"], does: "Why: the rule's card in the ledger — its history, what still asks, what to do" },
  { keys: ["x"], does: "Revoke what answered, or forget a count still learning" },
  { keys: ["w"], does: "Trust any command of the family, or go back to exact rules" },
  { keys: ["c"], does: "Copy the rule as opencode.json config" },
  { keys: ["a", "l"], does: "Back to the ledger: every rule, by kind and family" },
  { keys: ["/"], does: "Back to the ledger and filter it" },
  { keys: ["p"], does: "Pause Trust in this project, or resume it" },
  { keys: ["?", "esc"], does: "Hide these keys; esc goes back to the ledger" },
]

/** One section of the screen: a heading and the rows of its items, a window that follows the cursor. */
interface Section {
  heading: Row
  /** Rows of a section with nothing to list: drawn under the heading in place of items. */
  quiet?: Row[]
  items: ActivityItem[]
  /** What the `+ N more` row adds, after the count. */
  more: string
}

export function activityRows(input: ActivityInput): ActivityView {
  const { width, state, settings, now } = input
  const height = Math.max(MIN_HEIGHT, input.height)
  const model = activityModel(input)
  const index = Math.max(
    0,
    model.items.findIndex((item) => item.key === input.selected),
  )
  const item = model.items[index]
  const columns = columnsOf(model, width, now)
  /** Paused, the badge alone does not say what that means: it keeps counting, and answers nothing. */
  const rows: Row[] = [
    headerRow(
      input.project,
      state.paused,
      state.paused
        ? [muted("counting, answering nothing")]
        : columns.only
          ? [muted(`activity · all by ${columns.only}`)]
          : [muted("activity")],
      width,
    ),
  ]
  const hits: Hit[] = []

  if (input.keys) {
    rows.push(fit([], width))
    rows.push(...keyListBody(ACTIVITY_KEYS, width, height - 4))
    rows.push(fit([], width))
    rows.push(footerRow([closeHint("Hide Keys")], width))
    return { rows, ...(item ? { item } : {}), model, hits }
  }

  const sections: Section[] = []

  /* TODAY */
  const week = model.week.some((count) => count > 0)
  const todayLeft: Run[] =
    model.today > 0
      ? [
          { text: " TODAY", tone: "text", bold: true },
          muted("  Trust answered "),
          { text: String(model.today), tone: "success", bold: true },
          muted(` ${model.today === 1 ? "prompt" : "prompts"} for you`),
        ]
      : [
          { text: " TODAY", tone: "text", bold: true },
          muted(
            model.feed.length > 0
              ? "  nothing answered yet today · the latest before"
              : "  Nothing answered yet",
          ),
        ]
  sections.push({
    heading: week
      ? spread(todayLeft, [...sparkline(model.week), muted("  last 7 days ")], width)
      : fit(todayLeft, width),
    ...(model.feed.length === 0
      ? {
          quiet: wrapRuns(
            [
              muted(
                `Approve the same command ${settings.threshold} times in a row and Trust answers it from then on — that exact command, for that agent.`,
              ),
            ],
            Math.max(1, width - 3),
            2,
          ).map((row) => fit([{ text: "   " }, ...row], width)),
        }
      : {}),
    items: model.feed,
    more: model.today > 0 ? "earlier today" : "earlier",
  })

  /* ALMOST THERE */
  if (model.almost.length > 0) {
    const allClose = model.almost.every((each) => each.kind === "almost" && distanceOf(each.command) === 1)
    sections.push({
      heading: fit(
        [
          { text: " ALMOST THERE", tone: "text", bold: true },
          muted(allClose ? "  one more approval and Trust answers these" : "  closest first"),
        ],
        width,
      ),
      items: model.almost,
      more: "in the ledger",
    })
  }

  /* WATCH OUT */
  if (model.always.length > 0)
    sections.push({
      heading: fit(
        [
          { text: " " },
          badge("! WATCH OUT", "warning"),
          muted(`  OpenCode's own "always" approves more than it looks, until it restarts`),
        ],
        width,
      ),
      items: model.always,
      more: "",
    })

  /* RULES, and the way into the ledger */
  const { counts } = model
  const said: Run[] =
    counts.trusted + counts.learning + counts.once === 0
      ? [muted("nothing learned yet")]
      : [
          { text: `${counts.trusted} trusted`, tone: counts.trusted > 0 ? "success" : "muted" },
          muted(" · "),
          { text: `${counts.learning} learning`, tone: counts.learning > 0 ? "warning" : "muted" },
          muted(` · ${counts.once} seen once`),
        ]
  const ledgerButton = button("l", width >= 72 ? "Open the ledger" : "Ledger")
  const rulesRow = spread(
    [{ text: " RULES", tone: "text", bold: true }, { text: "  " }, ...said],
    [...ledgerButton, { text: " " }],
    width,
  )

  /**
   * Rows: the header and a row of air, each section's heading with a row of air above it, the rules
   * line, a row for a notice, the keys. What is left is the lists'.
   */
  const fixed = 1 + 1 + 1 + 1 + 1
  let gaps = sections.length
  const quietRows = sections.reduce((sum, section) => sum + (section.quiet?.length ?? 0), 0)
  let room = height - fixed - sections.length - gaps - quietRows
  /** Short of room for one row per list, the rows of air go first, the one under the header last. */
  const want = sections.filter((section) => section.items.length > 0).length
  let headerGap = true
  while (room < want && gaps > 0) {
    gaps--
    room++
  }
  if (room < want && headerGap) {
    headerGap = false
    room++
  }
  const allot = allotRows(sections, room, item)

  if (headerGap) rows.push(fit([], width))
  sections.forEach((section, at) => {
    /** The rows of air that survived sit above the later sections, so the first heads the screen. */
    if (at > 0 && at <= gaps) rows.push(fit([], width))
    rows.push(section.heading)
    for (const quiet of section.quiet ?? []) rows.push(quiet)
    const shown = windowOf(section.items, allot[at] ?? 0, item)
    for (const each of shown.items) {
      const selected = each === item
      const row = itemRow(each, input, columns, width)
      rows.push(selected ? cursorRow(row, width) : row)
      hits.push({ kind: "row", y: rows.length - 1, key: each.key })
    }
    if (shown.hidden > 0)
      rows.push(fit([muted(`   + ${shown.hidden} more${section.more ? ` ${section.more}` : ""}`)], width))
  })
  if (gaps === sections.length) rows.push(fit([], width))
  rows.push(rulesRow)
  hits.push(...buttonHits(rulesRow, rows.length - 1, ["ledger"]))
  /** Whatever the lists did, the notice row and the keys are the last two rows. */
  const body = rows.slice(0, height - 2)
  while (body.length < height - 2) body.push(fit([], width))
  body.push(
    input.notice
      ? fit([{ text: ` ${input.notice.text}`, tone: input.notice.tone ?? "muted" }], width)
      : fit([], width),
  )
  body.push(footerRow(hintsFor(item, model, state.paused), width))
  return { rows: body, ...(item ? { item } : {}), model, hits: hits.filter((hit) => hit.y < height - 2) }
}

/**
 * Rows for each section's list, out of `room`: one each first, then the feed up to five, what is close
 * up to four, OpenCode's up to two, then whatever is left to whichever still has more. The section
 * the cursor is in is never left without it.
 */
function allotRows(sections: readonly Section[], room: number, item: ActivityItem | undefined): number[] {
  const need = sections.map((section) => section.items.length)
  const out = sections.map(() => 0)
  let left = Math.max(0, room)
  const give = (at: number, upTo: number) => {
    while (left > 0 && (out[at] as number) < Math.min(upTo, need[at] as number)) {
      out[at] = (out[at] as number) + 1
      left--
    }
  }
  const mine = item ? sections.findIndex((section) => section.items.includes(item)) : -1
  if (mine >= 0) give(mine, 1)
  for (let at = 0; at < sections.length; at++) give(at, 1)
  const caps = [5, 4, 2]
  for (let at = 0; at < sections.length; at++) give(at, caps[at] ?? 2)
  for (let at = 0; at < sections.length; at++) give(at, Number.MAX_SAFE_INTEGER)
  return out
}

/**
 * The items a section shows in `rows`: all of them when they fit; otherwise a window around the cursor
 * with its last row saying how many are not shown.
 */
function windowOf(
  items: readonly ActivityItem[],
  rows: number,
  item: ActivityItem | undefined,
): { items: ActivityItem[]; hidden: number } {
  if (items.length <= rows) return { items: [...items], hidden: 0 }
  if (rows <= 0) return { items: [], hidden: 0 }
  const take = rows === 1 ? 1 : rows - 1
  const at = item ? items.indexOf(item) : -1
  const start = at < 0 ? 0 : Math.max(0, Math.min(at - Math.floor(take / 2), items.length - take))
  const shown = items.slice(start, start + take)
  return { items: shown, hidden: rows === 1 ? 0 : items.length - shown.length }
}

/* ─── one row ────────────────────────────────────────────────────────────────────────────────── */

interface Columns {
  /** The time column: `09:41`, or `Tue 09:41` when the feed reaches past today. */
  time: number
  /** Where every list's agent chip starts, so the chips read straight down the screen. */
  chipAt: number
  /** The widest chip, padded to; 0 when there is one agent, and no chip is drawn. */
  chip: number
  /** The longest meter among what is close. */
  meter: number
  /** The one agent every row is for, said once in the header instead of on every row. */
  only?: string
}

/** ` ✓ ` and the time column, then two cells: where every list's command starts. */
const rowLead = (columns: { time: number }) => 3 + columns.time + 2

function columnsOf(model: ActivityModel, width: number, now: number): Columns {
  const time = Math.max(
    5,
    ...model.feed.map((item) => (item.kind === "answer" ? clock(item.answer.at, now).length : 0)),
  )
  const agents = model.items.map((item) =>
    item.kind === "answer"
      ? item.answer.agent
      : item.kind === "almost"
        ? leadOf(item.command).entry.agent
        : item.group.agent,
  )
  const distinct = [...new Set(agents)]
  const only = distinct.length === 1 ? distinct[0] : undefined
  const chipWidth = only ? 0 : Math.max(0, ...agents.map((agent) => widthOf(agent) + 2))
  const lead = 3 + time + 2
  const leads = model.items.map((item) => {
    if (item.kind === "answer") return lead + widthOf(labelOf(item.answer)) + (item.count > 1 ? 4 : 0)
    if (item.kind === "almost")
      return lead + widthOf(showSubject(item.command.permission, item.command.subject))
    return lead + widthOf(item.group.patterns.join("  "))
  })
  /** The commands get what they need up to about half the row; the reasons take the rest. */
  /** Without an agent column the commands take more of the row. */
  const chipAt = Math.min(
    Math.max(24, ...leads.map((lead) => lead + 2)),
    Math.floor(width * (only ? 0.55 : 0.42)),
  )
  const meterWidth = Math.max(
    0,
    ...model.almost.map((item) => (item.kind === "almost" ? needOf(item.command) : 0)),
  )
  return { time, chipAt, chip: chipWidth, meter: meterWidth, ...(only ? { only } : {}) }
}

function needOf(command: Command): number {
  const { stand } = leadOf(command)
  return stand.kind === "counting" ? stand.need : 0
}

/** `text` in exactly `room` columns: its paths cut in the middle, or padded. */
const cell = (text: string, room: number) => {
  const shown = squeeze(text, room)
  return `${shown}${" ".repeat(Math.max(0, room - widthOf(shown)))}`
}

/** The agent's chip and two cells after it; nothing when there is one agent. */
function chipCell(agent: string, columns: Columns): Run[] {
  if (columns.chip === 0) return []
  return [chip(agent), { text: " ".repeat(Math.max(0, columns.chip - widthOf(agent) - 2)) }, { text: "  " }]
}

function itemRow(item: ActivityItem, input: ActivityInput, columns: Columns, width: number): Row {
  const lead = rowLead(columns)
  /** The mark, then the time column (blank on a list without times), as every row starts. */
  const start = (mark: string, tone: Run["tone"], time = ""): Run[] => [
    { text: " " },
    { text: `${mark} `, tone },
    muted(time.padStart(columns.time)),
    { text: "  " },
  ]
  if (item.kind === "answer") {
    const { answer } = item
    const count = item.count > 1 ? ` ${item.count}×` : ""
    const room = Math.max(4, columns.chipAt - lead - 2 - count.length)
    const label = squeeze(labelOf(answer), room)
    return fit(
      [
        ...start("✓", "success", clock(answer.at, input.now)),
        plain(label),
        muted(count),
        { text: " ".repeat(Math.max(0, room - widthOf(label))) },
        { text: "  " },
        ...chipCell(answer.agent, columns),
        muted(answerWhy(answer, input)),
      ],
      width,
    )
  }
  if (item.kind === "almost") {
    const { command } = item
    const { stand, entry } = leadOf(command)
    const danger = command.danger !== undefined
    const room = Math.max(4, columns.chipAt - lead - 2)
    const counting = stand.kind === "counting" ? stand : undefined
    const name = `${command.permission === "bash" ? "" : `${command.permission} `}${showSubject(command.permission, command.subject)}`
    return fit(
      [
        ...start("○", danger ? "error" : "warning"),
        plain(cell(name, room)),
        { text: "  " },
        ...chipCell(entry.agent, columns),
        ...(counting ? meter(counting.have, counting.need, danger) : []),
        { text: " ".repeat(Math.max(0, columns.meter - (counting?.need ?? 0))) },
        muted(counting ? `  ${counting.have} of ${counting.need}` : ""),
        ...(danger ? [{ text: "  " }, badge("dangerous", "error")] : []),
      ],
      width,
    )
  }
  const { group } = item
  const room = Math.max(4, columns.chipAt - lead - 2)
  return fit(
    [
      ...start("!", "warning"),
      plain(
        cell(
          `${group.permission === "bash" ? "" : `${group.permission} `}${group.patterns.join("  ")}`,
          room,
        ),
      ),
      { text: "  " },
      ...chipCell(group.agent, columns),
      ...(width - columns.chipAt - columns.chip > 26
        ? [muted(" "), keyRun("enter"), muted(" what it covers")]
        : []),
    ],
    width,
  )
}

const keyRun = (name: string): Run => ({ text: `[${name}]`, tone: "accent", bold: true })

/* ─── the keys ───────────────────────────────────────────────────────────────────────────────── */

function hintsFor(item: ActivityItem | undefined, model: ActivityModel, paused: boolean): Hint[] {
  const hints: Hint[] = []
  if (item) {
    const target = targetOf(item, model)
    hints.push({ key: "enter", label: item.kind === "always" ? "What It Covers" : "Why", priority: 5 })
    const x = revokeLabel(target)
    hints.push({ key: "x", label: x.label, priority: 4, ...(x.off ? { off: true } : {}) })
    const w = widenLabel(widenScope(target, model.families), false)
    hints.push({
      key: "w",
      label: w.label.startsWith("Undo") ? "Undo Family" : "Trust Family",
      priority: 3,
      ...(w.off ? { off: true } : {}),
    })
  }
  hints.push({ key: "a", label: "Ledger", priority: 6 })
  hints.push({ key: "p", label: paused ? "Resume" : "Pause", priority: paused ? 5.5 : 2 })
  hints.push({ key: "?", label: "Keys", priority: 4.5 })
  hints.push(closeHint("Back"))
  return hints
}
