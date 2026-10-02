/**
 * The ledger dialog: everything Trust has learned in this project, grouped by what it does, and what
 * you can do about it.
 *
 *   Trust in this project                       3 in a row · dangerous +5 · unused 30 days expires
 *
 *   ▾ ls                                                    2 trusted · 1 counting    2m ago
 *        ● ls -la                       general               trusted · 3 auto       now
 *        ● ls -la src                   general                        trusted    2m ago
 *        ○ ls -R docs                   general                            2/3    5m ago
 *   ▸ git status                        build, general       1 trusted · 1 counting   1h ago
 *   ● echo "---"                        general                        trusted    3m ago
 *   + 64 approved once · [a] show all
 *
 *   ───────────────────────────────────────────────────────────────────────────────────────────
 *   Exactly   echo "---"
 *   Answers   only this exact text, as general. Still asks: echo · echo "---" > out.txt
 *   [enter] Fold   [x] Revoke   [w] Trust Any echo   [c] Copy As Config   [esc] Close
 *
 * **Families** (family.ts) are what the rows are grouped by: `ls -la`, `ls -x` and `ls -R docs` are
 * all `ls`. A family with one rule and no widening is drawn as that one row — a heading over a single
 * line is a fold with nothing to fold. Families start folded; `enter` opens one.
 *
 * **One row per command**, however many agents earned it: `git status --short` trusted for `build`
 * and at 2/3 for `general` was two rows that read as a duplicate. Counting is still per agent — the
 * row lists each agent and its own standing.
 *
 * **The panel** under the list says exactly what the selected line is — every argument quoted so no
 * font can merge `---` into a line — and in a sentence what it answers and what still asks. The
 * rows are the same vocabulary as the sidebar's: a filled dot is trusted, a hollow one counting.
 */

import { closeHint, fitHints, type Hint, labelCase } from "@opencode-cockpit/client/design"
import {
  anyOf,
  familyOf,
  narrower,
  outside,
  readSubject,
  redirected,
  showSubject,
  widenable,
} from "../family.ts"
import {
  type Always,
  type Entry,
  type Event,
  keyOf,
  type State,
  standing,
  type Thresholds,
  type Widened,
} from "../ledger.ts"
import { ago, filled, fit, type Row, type Run, spread, type Tone, widthOf } from "./rows.ts"

export type LedgerItem = { kind: "rule"; entry: Entry } | { kind: "always"; always: Always }

/**
 * Trusted first, then those being counted, then the rest — each newest first. A subject that was
 * only ever rejected has nothing to show and is left out.
 */
export function ledgerItems(state: State, settings: Thresholds, now: number): LedgerItem[] {
  const rank = (entry: Entry) => {
    const where = standing(entry, entry.danger, settings, now)
    return where.trusted ? 0 : where.have > 0 ? 1 : 2
  }
  const rules = [...state.entries.values()]
    .filter((entry) => entry.approvals > 0 || entry.autos > 0)
    .sort((a, b) => rank(a) - rank(b) || b.lastAt - a.lastAt)
    .map((entry): LedgerItem => ({ kind: "rule", entry }))
  const always = [...state.always].reverse().map((always): LedgerItem => ({ kind: "always", always }))
  return [...rules, ...always]
}

/**
 * What the dialog lists: by default, everything but a command approved once and not since. Most of
 * those never come back — an agent reading a project runs `head -60`, `wc -l` on this file and that —
 * and a list of forty `1/3` rows buried the few that mattered (seen on a real session). They are
 * folded into one line rather than hidden: `all` lists them, `a` in the dialog. A command a widened
 * family answers is never "once": it is in use.
 */
export function ledgerShown(
  items: readonly LedgerItem[],
  settings: Thresholds,
  now: number,
  all: boolean,
): { items: LedgerItem[]; folded: number } {
  if (all) return { items: [...items], folded: 0 }
  const once = (item: LedgerItem) => {
    if (item.kind !== "rule") return false
    const where = standing(item.entry, item.entry.danger, settings, now)
    return !where.trusted && where.have <= 1 && item.entry.autos === 0
  }
  const shown = items.filter((item) => !once(item))
  return { items: shown, folded: items.length - shown.length }
}

/* ─── the model: families, rules, lines ──────────────────────────────────────────────────────── */

export interface Reading {
  state: State
  settings: Thresholds
  now: number
}

/** Where one agent stands on one command, as the ledger words it. */
export type Stand =
  | { kind: "trusted" }
  /** Not trusted by its own count, answered through a family you widened. */
  | { kind: "widened"; family: string }
  | { kind: "counting"; have: number; need: number; expired: boolean }

export function standOf(entry: Entry, { state, settings, now }: Reading): Stand {
  const where = standing(entry, entry.danger, settings, now)
  if (where.trusted) return { kind: "trusted" }
  const family = familyOf(entry.permission, entry.subject)
  if (
    state.widened.has(keyOf(entry.permission, entry.agent, family)) &&
    outside(entry.permission, entry.subject) === undefined
  )
    return { kind: "widened", family }
  return { kind: "counting", have: where.have, need: where.need, expired: where.expired }
}

const rankOf = (stand: Stand) =>
  stand.kind === "trusted" ? 0 : stand.kind === "widened" ? 1 : stand.have > 0 ? 2 : 3

/** One command, with every agent that has a standing for it — the best first. */
export interface RuleGroup {
  key: string
  permission: string
  subject: string
  family: string
  entries: Entry[]
  lastAt: number
}

export interface FamilyGroup {
  key: string
  permission: string
  family: string
  /** Best first: trusted, answered through the widening, counting, the rest; newest first within. */
  rules: RuleGroup[]
  /** The agents you trusted the whole family for. */
  widened: Widened[]
  lastAt: number
}

export type Line =
  | { kind: "family"; key: string; family: FamilyGroup; open: boolean }
  | { kind: "rule"; key: string; family: FamilyGroup; rule: RuleGroup; nested: boolean }
  | { kind: "always"; key: string; always: Always }

/** The rules' items grouped into families, with every widened family — even one with no rule left. */
export function ledgerFamilies(items: readonly LedgerItem[], reading: Reading): FamilyGroup[] {
  const rules = new Map<string, RuleGroup>()
  for (const item of items) {
    if (item.kind !== "rule") continue
    const { entry } = item
    const key = JSON.stringify([entry.permission, entry.subject])
    const found = rules.get(key)
    if (found) {
      found.entries.push(entry)
      found.lastAt = Math.max(found.lastAt, entry.lastAt)
    } else
      rules.set(key, {
        key,
        permission: entry.permission,
        subject: entry.subject,
        family: familyOf(entry.permission, entry.subject),
        entries: [entry],
        lastAt: entry.lastAt,
      })
  }
  const best = (a: Entry, b: Entry) =>
    rankOf(standOf(a, reading)) - rankOf(standOf(b, reading)) || b.lastAt - a.lastAt
  const families = new Map<string, FamilyGroup>()
  const familyFor = (permission: string, family: string) => {
    const key = JSON.stringify([permission, family])
    let found = families.get(key)
    if (!found) {
      found = { key, permission, family, rules: [], widened: [], lastAt: 0 }
      families.set(key, found)
    }
    return found
  }
  for (const rule of rules.values()) {
    rule.entries.sort(best)
    const family = familyFor(rule.permission, rule.family)
    family.rules.push(rule)
    family.lastAt = Math.max(family.lastAt, rule.lastAt)
  }
  for (const widened of reading.state.widened.values()) {
    const family = familyFor(widened.permission, widened.family)
    family.widened.push(widened)
    family.lastAt = Math.max(family.lastAt, widened.at)
  }
  const ruleRank = (rule: RuleGroup) => rankOf(standOf(rule.entries[0] as Entry, reading))
  const familyRank = (family: FamilyGroup) =>
    family.widened.length > 0 ? 0 : Math.min(...family.rules.map(ruleRank))
  for (const family of families.values())
    family.rules.sort((a, b) => ruleRank(a) - ruleRank(b) || b.lastAt - a.lastAt)
  return [...families.values()].sort((a, b) => familyRank(a) - familyRank(b) || b.lastAt - a.lastAt)
}

/** A family drawn as its one row: one rule, nothing widened, so a heading would fold nothing. */
const single = (family: FamilyGroup) => family.rules.length === 1 && family.widened.length === 0

export interface LedgerModel {
  lines: Line[]
  /** Commands approved once, folded into one line (`ledgerShown`). */
  folded: number
}

/** What the dialog lists, in order: each family (open or not), then OpenCode's own approvals. */
export function ledgerModel(reading: Reading & { all: boolean; open: ReadonlySet<string> }): LedgerModel {
  const { items, folded } = ledgerShown(
    ledgerItems(reading.state, reading.settings, reading.now),
    reading.settings,
    reading.now,
    reading.all,
  )
  const lines: Line[] = []
  for (const family of ledgerFamilies(items, reading)) {
    if (single(family)) {
      const rule = family.rules[0] as RuleGroup
      lines.push({ kind: "rule", key: `r:${rule.key}`, family, rule, nested: false })
      continue
    }
    const open = reading.open.has(family.key)
    lines.push({ kind: "family", key: `f:${family.key}`, family, open })
    if (open)
      for (const rule of family.rules)
        lines.push({ kind: "rule", key: `r:${rule.key}`, family, rule, nested: true })
  }
  for (const item of items)
    if (item.kind === "always")
      lines.push({
        kind: "always",
        key: `a:${JSON.stringify([item.always.at, item.always.agent, item.always.patterns])}`,
        always: item.always,
      })
  return { lines, folded }
}

/* ─── drawing the list ───────────────────────────────────────────────────────────────────────── */

/** One line's parts: the left grows and gives way, the three on the right are columns. */
interface Cells {
  left: Run[]
  agent: string
  status: Run[]
  when: string
}

const prefix = (permission: string): Run[] =>
  permission === "bash" ? [] : [{ text: `${permission} `, tone: "tool" }]

const distinct = (values: readonly string[]) => [...new Set(values)]

function standRun(stand: Stand, danger: boolean): Run {
  if (stand.kind === "trusted") return { text: "trusted", tone: "success" }
  if (stand.kind === "widened") return { text: "widened", tone: "success" }
  return {
    text: `${stand.have}/${stand.need}`,
    tone: stand.expired ? "muted" : danger ? "error" : "warning",
  }
}

/** Separators between agents' standings: `trusted, 2/3`, in the order the agent column names them. */
function joined(runs: readonly Run[]): Run[] {
  return runs.flatMap((run, index) => (index === 0 ? [run] : [{ text: ", ", tone: "muted" as const }, run]))
}

function ruleCells(rule: RuleGroup, nested: boolean, reading: Reading): Cells {
  const stands = rule.entries.map((entry) => standOf(entry, reading))
  const answered = stands.some((stand) => stand.kind !== "counting")
  const danger = rule.entries.find((entry) => entry.danger)?.danger
  const autos = rule.entries.reduce((sum, entry) => sum + entry.autos, 0)
  const expired = stands.every((stand) => stand.kind === "counting" && stand.expired)
  return {
    left: [
      { text: nested ? "     " : " " },
      answered ? { text: "● ", tone: "success" } : { text: "○ ", tone: "warning" },
      ...prefix(rule.permission),
      { text: showSubject(rule.permission, rule.subject), tone: "text" },
      ...(danger ? [{ text: `  ${danger}`, tone: "error" as const }] : []),
    ],
    agent: rule.entries.map((entry) => entry.agent).join(", "),
    status: [
      ...joined(stands.map((stand, index) => standRun(stand, rule.entries[index]?.danger !== undefined))),
      ...(answered && autos > 0 ? [{ text: ` · ${autos} auto`, tone: "muted" as const }] : []),
    ],
    when: expired ? "expired" : ago(reading.now - rule.lastAt),
  }
}

/** Every agent named anywhere in a family: its rules' and its widenings'. */
const agentsOf = (family: FamilyGroup) =>
  distinct([
    ...family.rules.flatMap((rule) => rule.entries.map((entry) => entry.agent)),
    ...family.widened.map((each) => each.agent),
  ])

function familyCells(family: FamilyGroup, open: boolean, reading: Reading): Cells {
  const agents = agentsOf(family)
  const widenedFor = family.widened.map((each) => each.agent)
  const trusted = family.rules.filter((rule) =>
    rule.entries.some((entry) => standOf(entry, reading).kind !== "counting"),
  ).length
  const counting = family.rules.length - trusted
  const counts: Run[] = [
    ...(trusted > 0 ? [{ text: `${trusted} trusted`, tone: "success" as const }] : []),
    ...(trusted > 0 && counting > 0 ? [{ text: " · ", tone: "muted" as const }] : []),
    ...(counting > 0 ? [{ text: `${counting} counting`, tone: "warning" as const }] : []),
  ]
  return {
    left: [
      { text: ` ${open ? "▾" : "▸"} `, tone: "muted" },
      ...prefix(family.permission),
      { text: showSubject(family.permission, family.family), tone: "text", bold: true },
      ...(widenedFor.length > 0
        ? [
            {
              text: ` — any, widened${agents.length > widenedFor.length ? ` for ${widenedFor.join(", ")}` : ""}`,
              tone: "success" as const,
            },
          ]
        : []),
    ],
    agent: agents.length > 1 ? agents.join(", ") : "",
    status: counts.length > 0 ? counts : [{ text: "no rules yet", tone: "muted" }],
    when: ago(reading.now - family.lastAt),
  }
}

function alwaysCells(always: Always, now: number): Cells {
  return {
    left: [
      { text: " ! ", tone: "warning" },
      ...prefix(always.permission),
      { text: always.patterns.join("  "), tone: "warning" },
    ],
    agent: always.agent,
    status: [{ text: "until restart", tone: "muted" }],
    when: ago(now - always.at),
  }
}

function cellsOf(line: Line, reading: Reading): Cells {
  if (line.kind === "always") return alwaysCells(line.always, reading.now)
  if (line.kind === "family") return familyCells(line.family, line.open, reading)
  return ruleCells(line.rule, line.nested, reading)
}

const textOf = (runs: readonly Run[]) => runs.map((run) => run.text).join("")

/** The right-hand columns sized to the widest in the list, so they read straight down. */
function rowOf(cells: Cells, columns: { agent: number; status: number; when: number }, width: number): Row {
  const status = textOf(cells.status)
  return spread(
    cells.left,
    [
      { text: cells.agent.padEnd(columns.agent + 2), tone: "info" },
      { text: " ".repeat(Math.max(0, columns.status - status.length)) },
      ...cells.status,
      { text: `  ${cells.when.padStart(columns.when)} `, tone: "muted" },
    ],
    width,
  )
}

/* ─── the panel: exactly what it is ──────────────────────────────────────────────────────────── */

/** Rows the panel always takes, so moving the cursor never moves the list. */
export const PANEL_ROWS = 3
const LABEL = 10

/** `runs` wrapped at spaces into rows of `width`, at most `max`; the last says `…` when cut. */
export function wrapRuns(runs: readonly Run[], width: number, max: number): Row[] {
  const words: Run[] = []
  for (const run of runs) {
    /** A command shown as an example is not broken across rows when it fits on one. */
    if (run.tone === "text" && widthOf(run.text) <= width) {
      words.push(run)
      continue
    }
    for (const part of run.text.split(/(?<= )/)) if (part !== "") words.push({ ...run, text: part })
  }
  const lines: Row[] = [[]]
  let used = 0
  for (const word of words) {
    const w = widthOf(word.text.trimEnd())
    if (used > 0 && used + w > width) {
      lines.push([])
      used = 0
    }
    ;(lines.at(-1) as Row).push(word)
    used += widthOf(word.text)
  }
  /** A row's last space is not part of it: counted, it pushed a word that fit exactly into `…`. */
  for (const line of lines) {
    const last = line.at(-1)
    if (last) line[line.length - 1] = { ...last, text: last.text.trimEnd() }
  }
  if (lines.length <= max) return lines.map((line) => fit(line, width))
  const kept = lines.slice(0, max)
  const rest = lines.slice(max).flat()
  /**
   * The overflow joins the last row, which `fit` then cuts with `…`: it always overflows, because its
   * first word is the one that did not fit there.
   */
  kept[max - 1] = [...(kept[max - 1] as Row), ...rest]
  return kept.map((line) => fit(line, width))
}

interface Said {
  label: string
  runs: Run[]
}

const muted = (text: string): Run => ({ text, tone: "muted" })
const plain = (text: string): Run => ({ text, tone: "text" })
const agentRun = (text: string): Run => ({ text, tone: "info" })

/** What a widening never covers, in words — the same three `family.outside` holds back. */
const EXCEPT = "except dangerous ones, ones that write a file and ones that run another program"

function standWords(stand: Stand): string {
  if (stand.kind === "trusted") return "trusted"
  if (stand.kind === "widened") return "answered through the family"
  return `${stand.have}/${stand.need}`
}

/** What still asks once a command is trusted exactly: a smaller one, and the same into a file. */
function stillAsks(rule: RuleGroup): Run[] {
  if (rule.permission === "edit") return [muted(" Any other file still asks.")]
  if (rule.permission !== "bash") return [muted(` Any other ${rule.permission} still asks.`)]
  const smaller = narrower(rule.subject)
  const into = redirected(rule.subject)
  const examples = [smaller, into].filter((each): each is string => each !== undefined)
  const runs: Run[] = [muted(" Still asks: ")]
  examples.forEach((example, index) => {
    if (index > 0) runs.push(muted(" · "))
    runs.push(plain(example))
  })
  if (!smaller) runs.push(muted(examples.length > 0 ? " · any added argument" : "any added argument"))
  return runs
}

function ruleSaid(rule: RuleGroup, reading: Reading): Said {
  const lead = rule.entries[0] as Entry
  const stand = standOf(lead, reading)
  const others: Run[] = rule.entries
    .slice(1)
    .flatMap((entry) => [
      muted(" Also "),
      agentRun(entry.agent),
      muted(`: ${standWords(standOf(entry, reading))}.`),
    ])
  /** In a widened family, but one of the commands a widening leaves to its own count. */
  const widenedHere = reading.state.widened.has(keyOf(rule.permission, lead.agent, rule.family))
  const why = outside(rule.permission, rule.subject)
  const notCovered: Run[] =
    widenedHere && why !== undefined
      ? [muted(` Not covered by ${anyOf(rule.permission, rule.family)}: ${why}.`)]
      : []
  /** A row that is its family alone is the only place to say `w` will never widen it. */
  const can = widenable(rule.permission, rule.family)
  const never: Run[] =
    rule.permission === "bash" && !can.ok
      ? [muted(` Never widened: ${can.why.includes("dangerous") ? "the family is dangerous" : can.why}.`)]
      : []
  if (stand.kind === "widened")
    return {
      label: "Answers",
      runs: [
        plain(anyOf(rule.permission, stand.family)),
        muted(" as "),
        agentRun(lead.agent),
        muted(`, because you widened it — ${EXCEPT}.`),
        ...others,
      ],
    }
  if (stand.kind === "trusted")
    return {
      label: "Answers",
      runs: [
        muted("only this exact text, as "),
        agentRun(lead.agent),
        muted("."),
        ...stillAsks(rule),
        ...others,
      ],
    }
  return {
    label: "Counting",
    runs: [
      muted(
        stand.expired
          ? "unused too long — counting again from 0, as "
          : `${stand.have} of ${stand.need} approvals in a row, as `,
      ),
      agentRun(lead.agent),
      muted(`.${lead.danger ? ` Dangerous (${lead.danger}), so it needs ${stand.need}.` : ""}`),
      ...never,
      ...notCovered,
      ...others,
      muted(" Once trusted it answers only this exact text."),
    ],
  }
}

/** The agent `w` widens a family for: the one on its best rule, unless it is widened already. */
function widenAgent(family: FamilyGroup, line: Line): string | undefined {
  if (line.kind === "rule") return line.rule.entries[0]?.agent
  return family.rules[0]?.entries[0]?.agent ?? family.widened[0]?.agent
}

function familySaid(family: FamilyGroup, line: Line): Said {
  const any = anyOf(family.permission, family.family)
  const except = family.permission === "edit" ? "not its subfolders" : EXCEPT
  if (family.widened.length > 0)
    return {
      label: "Widened",
      runs: [
        plain(any),
        muted(" as "),
        agentRun(family.widened.map((each) => each.agent).join(", ")),
        muted(` — ${except}. `),
        { text: "[w]", tone: "accent", bold: true },
        muted(" goes back to exact rules."),
      ],
    }
  const can = widenable(family.permission, family.family)
  if (!can.ok) return { label: "Widen", runs: [muted(`never: ${can.why}.`)] }
  const agent = widenAgent(family, line) ?? "this agent"
  const others = agentsOf(family).filter((each) => each !== agent)
  return {
    label: "Widen",
    runs: [
      { text: "[w]", tone: "accent", bold: true },
      muted(" would answer "),
      plain(any),
      muted(" as "),
      agentRun(agent),
      muted(`, ${except}.`),
      ...(others.length > 0
        ? [
            muted(
              ` Only ${agent}: ${agentsText(others)} ${others.length === 1 ? "keeps its" : "keep their"} own count.`,
            ),
          ]
        : []),
    ],
  }
}

/** The two things the panel says about a line: what it is, and what it does. */
export function explain(line: Line, reading: Reading): { exact: Said; said: Said } {
  if (line.kind === "always")
    return {
      exact: { label: "Always", runs: [{ text: line.always.patterns.join("  "), tone: "warning" }] },
      said: {
        label: "Means",
        runs: [
          muted("OpenCode's own approval for "),
          agentRun(line.always.agent),
          muted(", until it restarts — broader than it looks, and Trust cannot take it back."),
        ],
      },
    }
  if (line.kind === "family") {
    const { family } = line
    const count = family.rules.length
    return {
      exact: {
        label: "Family",
        runs: [
          ...prefix(family.permission),
          plain(showSubject(family.permission, family.family)),
          muted(` · ${count} command${count === 1 ? "" : "s"}: `),
          ...family.rules.flatMap((rule, index) => [
            ...(index > 0 ? [muted(" · ")] : []),
            plain(showSubject(rule.permission, rule.subject)),
          ]),
        ],
      },
      said: familySaid(family, line),
    }
  }
  return {
    exact: {
      label: "Exactly",
      runs: [...prefix(line.rule.permission), plain(showSubject(line.rule.permission, line.rule.subject))],
    },
    said: ruleSaid(line.rule, reading),
  }
}

function panelRows(line: Line | undefined, reading: Reading, width: number): Row[] {
  if (!line) return Array.from({ length: PANEL_ROWS }, () => fit([], width))
  const { exact, said } = explain(line, reading)
  const room = Math.max(1, width - 1 - LABEL - 1)
  const exactRows = wrapRuns(exact.runs, room, PANEL_ROWS)
  const saidRows = wrapRuns(said.runs, room, PANEL_ROWS)
  /** The command is what the panel is for: it gets two rows when it needs them, the sentence the rest. */
  const exactCount = Math.min(exactRows.length, Math.max(1, PANEL_ROWS - saidRows.length), PANEL_ROWS - 1)
  const exactShown = wrapRuns(exact.runs, room, exactCount)
  const saidShown = wrapRuns(said.runs, room, PANEL_ROWS - exactCount)
  const labelled = (label: string, rows: Row[]) =>
    rows.map((row, index) =>
      fit([{ text: ` ${(index === 0 ? label : "").padEnd(LABEL)}`, tone: "muted" }, ...row], width),
    )
  const rows = [...labelled(exact.label, exactShown), ...labelled(said.label, saidShown)]
  while (rows.length < PANEL_ROWS) rows.push(fit([], width))
  return rows.slice(0, PANEL_ROWS)
}

/* ─── the keys ───────────────────────────────────────────────────────────────────────────────── */

/** Families in a key's label: commands stay lowercase, and a long one is cut. */
function familyLabel(family: FamilyGroup): string {
  /** Where it runs is in the panel; the key names what it runs. */
  const text =
    family.permission === "bash"
      ? showSubject("bash", family.family).replace(/^\(in .*?\) /, "")
      : family.family
  return text.length > 24 ? `${text.slice(0, 23)}…` : text
}

/** Widened for the agent `w` acts on, so `w` would undo it. */
function isWidened(family: FamilyGroup, line: Line): boolean {
  if (line.kind === "family") return family.widened.length > 0
  const agent = widenAgent(family, line)
  return family.widened.some((each) => each.agent === agent)
}

function hintsFor(line: Line | undefined, input: LedgerInput): { hints: Hint[]; verbatim?: string } {
  const hints: Hint[] = []
  let verbatim: string | undefined
  if (line?.kind === "family") hints.push({ key: "enter", label: line.open ? "Fold" : "Open", priority: 6 })
  if (line?.kind === "rule" && line.nested) hints.push({ key: "enter", label: "Fold", priority: 6 })
  if (line)
    hints.push({ key: "x", label: "Revoke", priority: 5, ...(line.kind === "always" ? { off: true } : {}) })
  if (line && line.kind !== "always") {
    const family = line.family
    const widened = isWidened(family, line)
    /** A command is lowercase; `labelCase` would make `git status` read `Git Status`. */
    verbatim = `${widened ? "Undo Any" : "Trust Any"} ${familyLabel(family)}`
    hints.push({
      key: "w",
      label: verbatim,
      priority: 4,
      ...(!widened && !widenable(family.permission, family.family).ok ? { off: true } : {}),
    })
  }
  if (line) hints.push({ key: "c", label: "Copy As Config", priority: 2 })
  /** Above copying: it changes what the list shows, and a key that does that must be findable. */
  if (input.folded) hints.push({ key: "a", label: "Show All", priority: 3 })
  else if (input.all) hints.push({ key: "a", label: "Fold Seen Once", priority: 3 })
  hints.push({ key: "p", label: input.state.paused ? "Resume" : "Pause", priority: 0 })
  hints.push(closeHint())
  return verbatim ? { hints, verbatim } : { hints }
}

function footerRow(line: Line | undefined, input: LedgerInput): Row {
  const { hints, verbatim } = hintsFor(line, input)
  const fitted = fitHints(hints, Math.max(0, input.width - 1))
  const cased = verbatim ? ` ${labelCase(verbatim)}` : undefined
  const runs: Run[] = fitted.runs.map((run) => ({
    ...run,
    ...(cased !== undefined && verbatim && run.text === cased ? { text: ` ${verbatim}` } : {}),
  }))
  return fit([{ text: " " }, ...runs], input.width)
}

/* ─── the dialog ─────────────────────────────────────────────────────────────────────────────── */

export interface LedgerInput {
  width: number
  height: number
  lines: readonly Line[]
  /** The key of the line under the cursor; the first line when it is not in the list. */
  selected?: string
  state: State
  settings: Thresholds
  now: number
  notice?: { text: string; tone: Tone }
  /** Commands approved once, left out of the lines (`ledgerShown`); `all` says they are listed. */
  folded?: number
  all?: boolean
}

export interface LedgerView {
  rows: Row[]
  /** The first body line drawn, so the caller can keep the cursor in view on the next draw. */
  top: number
  /** The line under the cursor, as drawn: the caller's actions act on it. */
  line?: Line
}

function foldLine(count: number, width: number): Row {
  return fit([{ text: ` + ${count} approved once · [a] show all`, tone: "muted" }], width)
}

/** Header and gap above the list; the edge marker, the rule, the panel and the keys below it. */
const CHROME = 2 + 1 + 1 + PANEL_ROWS + 1

export function ledgerRows(input: LedgerInput): LedgerView {
  const { width, lines, state, settings, now } = input
  const reading: Reading = { state, settings, now }
  const rows: Row[] = []
  const title = state.paused ? "Trust in this project — paused" : "Trust in this project"
  rows.push(
    spread(
      [{ text: ` ${title}`, tone: state.paused ? "warning" : "text", bold: true }],
      [
        {
          text: `${settings.threshold} in a row · dangerous +${settings.dangerExtra} · ${
            settings.expireDays > 0 ? `unused ${settings.expireDays} days expires` : "never expires"
          } `,
          tone: "muted",
        },
      ],
      width,
    ),
  )
  rows.push(fit([], width))
  const room = Math.max(3, input.height - CHROME)
  const index = Math.max(
    0,
    lines.findIndex((line) => line.key === input.selected),
  )
  const line = lines[index]

  /** The body: the lines, the fold where the rules end, OpenCode's own approvals under their heading. */
  const body: { row: Row; line?: number }[] = []
  if (lines.length === 0)
    body.push({
      row: fit(
        [
          muted(
            input.folded
              ? ` ${input.folded} command${input.folded === 1 ? "" : "s"} approved once, none twice yet. [a] lists them.`
              : ` Nothing learned yet. Approve the same command ${settings.threshold} times in a row and Trust answers it from then on.`,
          ),
        ],
        width,
      ),
    })
  else {
    const cells = lines.map((each) => cellsOf(each, reading))
    const columns = {
      agent: Math.max(...cells.map((each) => each.agent.length)),
      status: Math.max(...cells.map((each) => textOf(each.status).length)),
      when: Math.max(...cells.map((each) => each.when.length)),
    }
    let heading = false
    lines.forEach((each, at) => {
      if (each.kind === "always" && !heading) {
        heading = true
        if (input.folded) body.push({ row: foldLine(input.folded, width) })
        if (body.length > 0) body.push({ row: fit([], width) })
        body.push({
          row: fit(
            [
              {
                text: ` OpenCode's own "always" — broader than it looks, and only until OpenCode restarts`,
                tone: "warning",
              },
            ],
            width,
          ),
        })
      }
      const row = rowOf(cells[at] as Cells, columns, width)
      body.push({ row: at === index ? filled(row, "selected") : row, line: at })
    })
    if (input.folded && !heading) body.push({ row: foldLine(input.folded, width) })
  }

  /** The cursor's line in view, with the lines around it. */
  const at = Math.max(
    0,
    body.findIndex((each) => each.line === index),
  )
  const top = Math.max(0, Math.min(at - Math.floor(room / 2), body.length - room))
  const shown = body.slice(top, top + room)
  /**
   * What is past either edge, said in the rows of air around the list — they were blank anyway, and
   * a list cut at the window's edge otherwise looks like the whole list.
   */
  const below = Math.max(0, body.length - top - room)
  if (top > 0) rows[1] = fit([muted(` ↑ ${top} more above`)], width)
  for (const each of shown) rows.push(each.row)
  while (rows.length < 2 + room) rows.push(fit([], width))
  rows.push(fit(below > 0 ? [muted(` ↓ ${below} more below`)] : [], width))
  /** A notice takes the rule's place: it is the one row that changes when you act. */
  rows.push(
    fit(
      input.notice
        ? [{ text: ` ${input.notice.text}`, tone: input.notice.tone }]
        : [{ text: ` ${"─".repeat(Math.max(0, width - 2))}`, tone: "border" }],
      width,
    ),
  )
  rows.push(...panelRows(line, reading, width))
  rows.push(footerRow(line, input))
  return line ? { rows, top, line } : { rows, top }
}

/* ─── acting on a line ───────────────────────────────────────────────────────────────────────── */

export interface Outcome {
  /** To append to the ledger: nothing is ever changed in place. */
  events: Event[]
  notice: { text: string; tone: Tone }
}

const agentsText = (agents: readonly string[]) =>
  agents.length <= 1 ? (agents[0] ?? "") : `${agents.slice(0, -1).join(", ")} and ${agents.at(-1)}`

/**
 * `w`: trust the whole family for one agent, or take that back. Never automatic — this is the only
 * place a `widened` event is made, and only a key press reaches it. A dangerous family is refused
 * with the reason, and nothing is written.
 */
export function widenLine(line: Line, at: number): Outcome {
  if (line.kind === "always")
    return {
      events: [],
      notice: { text: "OpenCode's own approvals have no family to widen.", tone: "warning" },
    }
  const { family } = line
  const any = anyOf(family.permission, family.family)
  if (isWidened(family, line)) {
    const agents =
      line.kind === "family" ? family.widened.map((each) => each.agent) : [widenAgent(family, line) as string]
    return {
      events: agents.map((agent) => ({
        v: 1,
        at,
        type: "unwidened",
        permission: family.permission,
        agent,
        family: family.family,
      })),
      notice: {
        text: `Back to exact rules: ${any} is no longer answered for ${agentsText(agents)}.`,
        tone: "muted",
      },
    }
  }
  const can = widenable(family.permission, family.family)
  if (!can.ok) return { events: [], notice: { text: `Not widened: ${can.why}.`, tone: "warning" } }
  const agent = widenAgent(family, line)
  if (agent === undefined)
    return { events: [], notice: { text: "No agent to widen it for.", tone: "warning" } }
  const others = agentsOf(family).filter((each) => each !== agent)
  return {
    events: [{ v: 1, at, type: "widened", permission: family.permission, agent, family: family.family }],
    notice: {
      text: `Trusted ${any} for ${agent}${family.permission === "bash" ? ` — ${EXCEPT} still ask` : ""}.${
        others.length > 0 ? ` ${agentsText(others)} keep${others.length === 1 ? "s" : ""} counting.` : ""
      } [w] again undoes it.`,
      tone: "success",
    },
  }
}

/**
 * `x`: a rule loses its trust for every agent on its row; a family heading loses every rule in it —
 * the ones folded away as approved once too — and its widening.
 */
export function revokeLine(line: Line, reading: Reading, at: number): Outcome {
  if (line.kind === "always")
    return {
      events: [],
      notice: {
        text: 'OpenCode keeps its own "always" until it restarts — Trust cannot take it back.',
        tone: "warning",
      },
    }
  const { threshold } = reading.settings
  if (line.kind === "rule") {
    const { rule } = line
    return {
      events: rule.entries.map((entry) => ({
        v: 1,
        at,
        type: "revoked",
        permission: entry.permission,
        agent: entry.agent,
        subject: entry.subject,
      })),
      notice: {
        text: `Revoked: ${showSubject(rule.permission, rule.subject)} is asked again until you approve it ${threshold}× more${
          rule.entries.length > 1 ? ` — for ${agentsText(rule.entries.map((entry) => entry.agent))}` : ""
        }.`,
        tone: "muted",
      },
    }
  }
  const { family } = line
  const entries = [...reading.state.entries.values()].filter(
    (entry) =>
      entry.permission === family.permission &&
      (entry.approvals > 0 || entry.autos > 0) &&
      familyOf(entry.permission, entry.subject) === family.family,
  )
  const subjects = distinct(entries.map((entry) => entry.subject)).length
  const events: Event[] = [
    ...entries.map(
      (entry): Event => ({
        v: 1,
        at,
        type: "revoked",
        permission: entry.permission,
        agent: entry.agent,
        subject: entry.subject,
      }),
    ),
    ...family.widened.map(
      (each): Event => ({
        v: 1,
        at,
        type: "unwidened",
        permission: each.permission,
        agent: each.agent,
        family: each.family,
      }),
    ),
  ]
  const name = showSubject(family.permission, family.family)
  return {
    events,
    notice: {
      text: `Revoked ${subjects} rule${subjects === 1 ? "" : "s"} in ${name}${
        family.widened.length > 0 ? ", and its widening" : ""
      } — each is asked again until approved ${threshold}× in a row.`,
      tone: "muted",
    },
  }
}

/**
 * A line as `opencode.json` would say it, for you to paste — Trust never writes OpenCode's config.
 * A family is a wildcard (`"ls *": "allow"`), and config says less than a widening: not which agent,
 * and not the commands a widening still asks about.
 */
export function configSnippet(line: Line): { text: string; note?: string } {
  if (line.kind === "always") {
    const patterns = Object.fromEntries(line.always.patterns.map((pattern) => [pattern, "allow"]))
    return { text: JSON.stringify({ permission: { [line.always.permission]: patterns } }) }
  }
  if (line.kind === "family") return familySnippet(line.family)
  const { rule } = line
  const placed = rule.subject.match(/^\(in [^)]*\) (.*)$/s)
  const pattern =
    rule.permission === "webfetch"
      ? `https://${rule.subject}/*`
      : placed
        ? (placed[1] as string)
        : rule.subject
  const text = JSON.stringify({ permission: { [rule.permission]: { [pattern]: "allow" } } })
  return placed
    ? { text, note: "a config rule cannot say where a command runs: this one allows it anywhere" }
    : { text }
}

function familySnippet(family: FamilyGroup): { text: string; note?: string } {
  const notes: string[] = []
  let pattern = family.family
  if (family.permission === "bash") {
    const read = readSubject(family.family)
    if (read) {
      const env = read.command.env.map((word) => word.replace(/=…$/, "=*"))
      pattern = `${[...env, ...read.command.argv].join(" ")} *`
      if (read.place !== undefined) notes.push("anywhere, not only where it ran")
    }
  } else if (family.permission === "edit") {
    pattern = `${family.family === "./" ? "" : family.family}*`
    notes.push("its * reaches into subfolders too")
  } else if (family.permission === "webfetch") pattern = `https://${family.family}/*`
  const any = anyOf(family.permission, family.family)
  notes.unshift(
    family.widened.length > 0
      ? `config cannot say which agent, so it allows ${any} for every one — even the ones Trust still asks about`
      : `wider than anything Trust answers here: ${any}, for every agent`,
  )
  return {
    text: JSON.stringify({ permission: { [family.permission]: { [pattern]: "allow" } } }),
    note: notes.join("; "),
  }
}
