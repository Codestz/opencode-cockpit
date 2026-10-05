/**
 * The ledger's card: what the selected row is and why — the command whole, where each agent stands,
 * the exact text and what still asks, the approvals that earned it, its family, and the buttons.
 */

import { anyOf, narrower, outside, redirected, showSubject, spelledWords, widenable } from "../family.ts"
import { earned, type History, type Mark } from "../history.ts"
import { keyOf, type Thresholds } from "../ledger.ts"
import { NOT_COVERED, revokeLabel, widenLabel, widenScope } from "./actions.ts"
import {
  type AlwaysGroup,
  type Command,
  countsOf,
  type Family,
  leadOf,
  type Reading,
  type Standing,
} from "./model.ts"
import { agentsText, button, chip, meter, muted, plain, plural, since, when, wrapRuns } from "./parts.ts"
import { filled, fit, type Row, type Run, rowText, widthOf } from "./rows.ts"
import { commandText, familyText, type Node, nodeTarget } from "./tree.ts"

/** `Still asks` and two spaces: the longest label. */
export const LABEL = 12

/** One labelled fact on the card: each line wraps on its own. `keep`: higher stays when room is short. */
interface Fact {
  label: string
  lines: Run[][]
  keep: number
  /** The first line is a row of moments: it keeps its newest end on one row rather than wrapping. */
  newest?: boolean
}

/** A fact's rows at `width`: each line wrapped, a row of moments cut from its oldest end. */
export function factLines(fact: Fact, width: number): Row[] {
  return fact.lines.flatMap((line, at) =>
    at === 0 && fact.newest ? [fit(tail(line, width), width)] : wrapRuns(line, width),
  )
}

export interface Button {
  key: string
  label: string
  off: boolean
  action: "revoke" | "widen" | "copy"
}

export interface CardParts {
  title: Run[]
  standing: Run[][]
  facts: Fact[]
  buttons: Button[]
}

export interface CardReading extends Reading {
  history: History
  families: readonly Family[]
}

/** The buttons a node offers: `x`, `w` where a family can widen, `c`. */
export function buttonsOf(node: Node, families: readonly Family[]): Button[] {
  const target = nodeTarget(node)
  const x = revokeLabel(target)
  const out: Button[] = [{ key: "x", label: x.label, off: x.off, action: "revoke" }]
  if (node.kind !== "always") {
    const w = widenLabel(widenScope(target, families))
    out.push({ key: "w", label: w.label, off: w.off, action: "widen" })
  }
  out.push({ key: "c", label: "Copy rule", off: false, action: "copy" })
  return out
}

/** The exact text, and — when a font could draw a word of it as something else — that word in words. */
function exactly(command: Command): Fact {
  const spelled = spelledWords(command.permission, command.subject)
  return {
    label: "Exactly",
    keep: 3,
    lines: [
      [
        plain(commandText(command)),
        ...(spelled.length > 0
          ? [
              muted(
                `  — ${spelled.map((each) => `${each.word} is ${each.said}`).join(", ")}, which some fonts draw as one line`,
              ),
            ]
          : []),
      ],
    ],
  }
}

/** What still asks once a command is trusted exactly: a smaller one, and the same into a file. */
function stillAsks(command: Command, widened: boolean): Fact {
  if (widened) return { label: "Still asks", keep: 6, lines: [[muted(`${NOT_COVERED}.`)]] }
  if (command.permission === "edit")
    return { label: "Still asks", keep: 6, lines: [[muted("any other file")]] }
  if (command.permission !== "bash")
    return { label: "Still asks", keep: 6, lines: [[muted(`any other ${command.permission}`)]] }
  const examples = [narrower(command.subject), redirected(command.subject)].filter(
    (each): each is string => each !== undefined,
  )
  const runs: Run[] = []
  examples.forEach((example, index) => {
    if (index > 0) runs.push(muted(" · "))
    runs.push(plain(example))
  })
  runs.push(muted(examples.length > 0 ? " · any other argument" : "any other argument"))
  return { label: "Still asks", keep: 6, lines: [runs] }
}

/**
 * The moments that made a rule what it is, oldest to newest, the newest kept when they do not all fit:
 * `✓ 9h  ✓ 9h  ✓ 9h  → trusted  answered 4×`.
 */
export function historyRuns(marks: readonly Mark[], need: number, expireMs: number, now: number): Run[] {
  const tokens: Run[][] = []
  let streak = 0
  let last = 0
  for (const each of marks) {
    if (each.kind === "rejected") {
      streak = 0
      tokens.push([{ text: "✗", tone: "error" }, muted(` ${since(now - each.at)}`)])
      continue
    }
    if (each.kind === "revoked") {
      streak = 0
      tokens.push([muted(`revoked ${since(now - each.at)}`)])
      continue
    }
    if (expireMs > 0 && last > 0 && each.at - last > expireMs) {
      streak = 0
      tokens.push([muted("expired")])
    }
    last = Math.max(last, each.at)
    if (each.kind === "auto") {
      tokens.push([muted(`answered ${each.count}×`)])
      continue
    }
    streak++
    tokens.push([{ text: "✓", tone: "success" }, muted(` ${since(now - each.at)}`)])
    if (streak === need) tokens.push([{ text: "→ trusted", tone: "success" }])
  }
  return tokens.flatMap((token, at) => [...(at > 0 ? [{ text: "  " }] : []), ...token])
}

/** The newest end of `runs` in `width` columns, `… ` in front when the oldest were left out. */
function tail(runs: readonly Run[], width: number): Run[] {
  if (widthOf(rowText(runs as Run[])) <= width) return [...runs]
  const out: Run[] = []
  let used = 2
  for (let i = runs.length - 1; i >= 0; i--) {
    const run = runs[i] as Run
    const w = widthOf(run.text)
    if (used + w > width) break
    out.unshift(run)
    used += w
  }
  while (out[0]?.text.trim() === "") out.shift()
  return [muted("… "), ...out]
}

/** The sentence under the moments: why it stands where it does. */
function historySaid(standing: Standing, marks: readonly Mark[], reading: CardReading): Run[] {
  const { entry, stand } = standing
  const { settings, now } = reading
  const expireMs = settings.expireDays * 86_400_000
  if (marks.length === 0)
    return [
      muted(
        `approved ${entry.approvals}× in all, first ${when(now - entry.firstAt)} — older than what is kept`,
      ),
    ]
  if (stand.kind === "trusted") {
    const got = earned(marks, Number.POSITIVE_INFINITY, expireMs)
    return [muted(`${got.streak} ${got.streak === 1 ? "approval" : "approvals"} in a row, all yours`)]
  }
  if (stand.kind === "widened")
    return [muted(`answered through ${anyOf(entry.permission, stand.family)}, not by its own count`)]
  if (stand.expired) return [muted(`unused over ${settings.expireDays} days, so it counts again from 0`)]
  const got = earned(marks, stand.need, expireMs)
  const left = stand.need - stand.have
  if (got.broken === "rejected" && got.brokenAt !== undefined)
    return [
      muted(`you rejected it ${when(now - got.brokenAt)}; ${stand.have} in a row since, ${left} more to go`),
    ]
  if (got.broken === "revoked" && got.brokenAt !== undefined)
    return [muted(`revoked ${when(now - got.brokenAt)}; ${stand.have} in a row since, ${left} more to go`)]
  return [muted(`${stand.have} in a row, all yours · ${left} more and Trust answers it`)]
}

/** One agent's standing, on the card's panel. */
function standingRuns(standing: Standing, danger: boolean): Run[] {
  const { entry, stand } = standing
  if (stand.kind === "trusted")
    return [
      { text: "✓ Trusted", tone: "success", bold: true },
      muted(" for "),
      chip(entry.agent),
      muted(entry.autos > 0 ? ` · answered ${entry.autos}×` : " · ready, not used yet"),
    ]
  if (stand.kind === "widened")
    return [
      { text: "✓ Answered", tone: "success", bold: true },
      muted(" for "),
      chip(entry.agent),
      muted(` · through ${anyOf(entry.permission, stand.family)}`),
    ]
  if (stand.expired)
    return [
      { text: "○ Expired", tone: "muted", bold: true },
      muted(" for "),
      chip(entry.agent),
      muted(" · counting from 0"),
    ]
  return [
    ...meter(stand.have, stand.need, danger),
    { text: ` ${stand.have} of ${stand.need}`, tone: "text", bold: true },
    muted(" for "),
    chip(entry.agent),
    muted(stand.have <= 1 && entry.autos === 0 ? " · seen once" : ` · ${stand.need - stand.have} more to go`),
  ]
}

function familyFact(
  family: Family | undefined,
  command: Command | undefined,
  reading: CardReading,
): Fact | undefined {
  if (!family) return undefined
  const trusted = family.commands.filter((each) => each.phase === "answering").length
  const name = familyText(family)
  const head: Run[] = [
    plain(name),
    muted(` · ${plural(family.commands.length, "command")}, ${trusted} trusted`),
  ]
  const agent = command
    ? leadOf(command).entry.agent
    : family.commands[0]
      ? leadOf(family.commands[0]).entry.agent
      : undefined
  const widenedFor = family.widened.filter((each) => agent === undefined || each.agent === agent)
  if (widenedFor.length > 0) {
    const at = Math.max(...widenedFor.map((each) => each.at))
    return {
      label: "Family",
      keep: 4,
      lines: [
        head,
        [
          plain(anyOf(family.permission, family.family)),
          muted(
            ` trusted for ${agentsText(widenedFor.map((each) => each.agent))} ${when(reading.now - at)} · [w] undoes it`,
          ),
        ],
      ],
    }
  }
  const can = widenable(family.permission, family.family)
  if (!can.ok) return { label: "Family", keep: 4, lines: [head, [muted(`never widened: ${can.why}`)]] }
  return {
    label: "Family",
    keep: 4,
    lines: [
      head,
      [
        muted("[w] trusts "),
        plain(anyOf(family.permission, family.family)),
        muted(` for ${agent ?? "this agent"}${family.commands.length > 1 ? ", not one by one" : ""}`),
      ],
    ],
  }
}

function commandCard(command: Command, family: Family | undefined, reading: CardReading): CardParts {
  const { settings, now, history } = reading
  const lead = leadOf(command)
  const danger = command.danger !== undefined
  const expireMs = settings.expireDays * 86_400_000
  const marks = history.marks.get(keyOf(command.permission, lead.entry.agent, command.subject)) ?? []
  const need =
    lead.stand.kind === "counting"
      ? lead.stand.need
      : settings.threshold + (danger ? settings.dangerExtra : 0)
  const facts: Fact[] = [exactly(command)]
  if (command.phase === "answering") facts.push(stillAsks(command, lead.stand.kind === "widened"))
  const many = command.standings.length > 1
  facts.push({
    label: "History",
    keep: 7,
    newest: true,
    lines: [
      marks.length > 0 ? historyRuns(marks, need, expireMs, now) : [muted("—")],
      [...(many ? [chip(lead.entry.agent), { text: " " }] : []), ...historySaid(lead, marks, reading)],
    ],
  })
  if (danger && command.phase !== "answering") {
    const can = family ? widenable(family.permission, family.family) : { ok: true as const }
    facts.push({
      label: "Dangerous",
      keep: 5,
      lines: [
        [
          muted(
            `${command.danger} — ${needOf(settings, true)} in a row instead of ${settings.threshold}${command.permission === "bash" && !can.ok && !family ? ", never widened" : ""}`,
          ),
        ],
      ],
    })
  }
  const why = outside(command.permission, command.subject)
  if (family && why !== undefined && family.widened.some((each) => each.agent === lead.entry.agent))
    facts.push({
      label: "Widened",
      keep: 5,
      lines: [
        [muted("but "), plain(anyOf(command.permission, family.family)), muted(` leaves it out: ${why}`)],
      ],
    })
  const fam = familyFact(family, command, reading)
  if (fam) facts.push(fam)
  if (lead.stand.kind === "trusted" && settings.expireDays > 0) {
    const left = Math.max(0, Math.ceil((lead.entry.lastAt + expireMs - now) / 86_400_000))
    facts.push({
      label: "Expires",
      keep: 1,
      lines: [
        [
          muted(
            left >= settings.expireDays
              ? `if unused for ${settings.expireDays} days`
              : `if unused for ${left} more ${left === 1 ? "day" : "days"}`,
          ),
        ],
      ],
    })
  }
  return {
    title: [{ text: commandText(command), tone: "text", bold: true }],
    standing: command.standings.map((each) => standingRuns(each, danger)),
    facts,
    buttons: [],
  }
}

const needOf = (settings: Thresholds, danger: boolean) =>
  settings.threshold + (danger ? settings.dangerExtra : 0)

function familyCard(family: Family, reading: CardReading): CardParts {
  const counts = countsOf(family.commands)
  const standing: Run[][] =
    family.widened.length > 0
      ? family.widened.map((each) => [
          { text: "✓ Any", tone: "success", bold: true },
          plain(` ${showSubject(family.permission, family.family)} …`),
          muted(" trusted for "),
          chip(each.agent),
          muted(` · you widened it ${when(reading.now - each.at)}`),
        ])
      : [
          [
            { text: `${counts.trusted} trusted`, tone: counts.trusted > 0 ? "success" : "muted", bold: true },
            muted(" · "),
            {
              text: `${counts.learning} learning`,
              tone: counts.learning > 0 ? "warning" : "muted",
              bold: true,
            },
            muted(` · ${counts.once} seen once`),
          ],
        ]
  const facts: Fact[] = []
  const list: Run[] = []
  family.commands.forEach((command, at) => {
    if (at > 0) list.push(muted(" · "))
    list.push({
      text: showSubject(command.permission, command.subject),
      tone: command.phase === "answering" ? "success" : "text",
    })
  })
  if (list.length > 0) facts.push({ label: "Commands", keep: 7, lines: [list] })
  const best = family.commands.find((command) => command.phase === "learning")
  if (best) {
    const { stand, entry } = leadOf(best)
    if (stand.kind === "counting")
      facts.push({
        label: "Closest",
        keep: 5,
        lines: [
          [
            plain(showSubject(best.permission, best.subject)),
            muted(`, ${stand.have} of ${stand.need} for ${entry.agent}`),
          ],
        ],
      })
  }
  if (family.widened.length > 0)
    facts.push({ label: "Still asks", keep: 6, lines: [[muted(`${NOT_COVERED}.`)]] })
  const fam = familyFact(family, undefined, reading)
  if (fam) facts.push({ ...fam, label: "Widen", lines: fam.lines.slice(1) })
  return {
    title: [
      { text: familyText(family), tone: "text", bold: true },
      muted(`  family of ${plural(family.commands.length, "command")}`),
    ],
    standing,
    facts,
    buttons: [],
  }
}

function alwaysCard(groups: readonly AlwaysGroup[], reading: CardReading): CardParts {
  const bash = groups.every((group) => group.permission === "bash")
  return {
    title: [{ text: `OpenCode's own "always"`, tone: "text", bold: true }],
    standing: groups.map((group) => [
      { text: "! ", tone: "warning", bold: true },
      { text: plural(group.patterns.length, "broad rule"), tone: "warning", bold: true },
      muted(" for "),
      chip(group.agent),
      muted(" · until OpenCode restarts"),
    ]),
    facts: [
      ...groups.map(
        (group): Fact => ({
          label: "Patterns",
          keep: 7,
          lines: [
            [
              ...(group.permission === "bash" ? [] : [muted(`${group.permission} `)]),
              plain(group.patterns.join("  ")),
              muted(`  ${when(reading.now - group.at)}`),
            ],
          ],
        }),
      ),
      {
        label: "Means",
        keep: 6,
        lines: [
          [
            muted(
              `OpenCode answers ${bash ? "every command that starts this way" : "everything these match"} — not only the one you approved.`,
            ),
          ],
        ],
      },
      {
        label: "Until",
        keep: 5,
        lines: [[muted("OpenCode restarts. Trust cannot take it back: restarting OpenCode ends it.")]],
      },
    ],
    buttons: [],
  }
}

export function cardOf(node: Node, reading: CardReading): CardParts {
  const parts =
    node.kind === "always"
      ? alwaysCard(node.groups, reading)
      : node.kind === "command"
        ? commandCard(node.command, node.family, reading)
        : familyCard(node.family, reading)
  return { ...parts, buttons: buttonsOf(node, reading.families) }
}

/** The card's buttons as one row, the focused one solid. */
function buttonRow(buttons: readonly Button[], focus: number | undefined, width: number): Row {
  const runs: Run[] = [{ text: " " }]
  buttons.forEach((each, at) => {
    if (at > 0) runs.push({ text: "  " })
    runs.push(...button(each.key, each.label, { on: focus === at, off: each.off }))
  })
  return fit(runs, width)
}

/**
 * The card in exactly `room` rows of `width`: the command whole (at most three rows), each agent's
 * standing, the facts, the buttons. Short of room, the rows of air go first, then the least telling
 * facts, then facts lose their second lines — never the title's first row or the buttons.
 */
export function cardRows(parts: CardParts, width: number, room: number, focus: number | undefined): Row[] {
  const panel = (runs: Run[]) => filled(fit([{ text: " " }, ...runs, { text: " " }], width), "panel")
  const titleRows = wrapRuns(parts.title, Math.max(1, width - 2), 3).map((row) => panel(row))
  const standing = parts.standing.map((runs) => panel(runs))
  const textWidth = Math.max(1, width - 2 - LABEL)
  const factRows = (fact: Fact, max: number) => {
    const rows = factLines(fact, textWidth)
    const kept =
      rows.length > max ? [...rows.slice(0, max - 1), fitLast(rows.slice(max - 1), textWidth)] : rows
    return kept.map((row, at) =>
      fit([{ text: "  " }, muted((at === 0 ? fact.label : "").padEnd(LABEL)), ...row], width),
    )
  }
  const buttons = buttonRow(parts.buttons, focus, width)
  let facts = [...parts.facts]
  const need = (list: readonly Fact[], full: boolean) =>
    list.reduce((sum, fact) => sum + (full ? factLines(fact, textWidth).length : 1), 0)
  let title = titleRows
  let stand = standing
  /** Rows of air: under the standing, and above the buttons. */
  let air = 2
  const total = (full: boolean) => title.length + stand.length + air + need(facts, full) + 1
  while (total(false) > room && air > 0) air--
  while (total(false) > room && title.length > 1) title = title.slice(0, -1)
  while (total(false) > room && stand.length > 1) stand = stand.slice(0, -1)
  while (total(false) > room && facts.length > 0) {
    const lowest = Math.min(...facts.map((fact) => fact.keep))
    const at = facts.findLastIndex((fact) => fact.keep === lowest)
    facts = facts.filter((_, index) => index !== at)
  }
  /** Every fact has a row; what is left goes to their second lines, in order. */
  let spare = room - (title.length + stand.length + air + facts.length + 1)
  const give = facts.map(() => 1)
  facts.forEach((fact, index) => {
    const want = factLines(fact, textWidth).length
    while (spare > 0 && (give[index] as number) < want) {
      give[index] = (give[index] as number) + 1
      spare--
    }
  })
  const rows: Row[] = [...title, ...stand]
  if (air >= 1) rows.push(fit([], width))
  facts.forEach((fact, index) => {
    rows.push(...factRows(fact, give[index] as number))
  })
  /** The buttons sit right under the facts, and the card's spare room is below them. */
  if (air >= 2) rows.push(fit([], width))
  rows.push(buttons)
  while (rows.length < room) rows.push(fit([], width))
  return rows.slice(0, room)
}

/** Rows past what a fact was given, as its last row, cut with `…`. */
function fitLast(rows: readonly Row[], width: number): Row {
  /** Each row without the padding `fit` gave it, joined by one space. */
  const bare = (row: Row): Run[] => {
    const out = [...row]
    while (out.length > 0 && (out.at(-1) as Run).text.trim() === "" && !(out.at(-1) as Run).fill) out.pop()
    const last = out.at(-1)
    if (last) out[out.length - 1] = { ...last, text: last.text.trimEnd() }
    return out
  }
  return fit(
    rows.flatMap((row, at) => [...(at > 0 ? [{ text: " " }] : []), ...bare(row)]),
    width,
  )
}

/** Where the buttons row landed in `cardRows`' output. */
export const buttonsAt = (rows: readonly Row[]) =>
  rows.findIndex((row) => row.some((run) => run.fill === "button" || run.fill === "buttonOn"))
