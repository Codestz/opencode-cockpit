/**
 * The ledger dialog: what Trust answers for you, what it is close to answering, why, and how to stop
 * it — the four questions a person opens it with, in that order.
 *
 *   Trust in this project                                                                   on
 *
 *   Answers for you  5 commands                               agent  answered   last
 *   ▸ ls  any ls … · 4 commands                             general        4×    now
 *   ● git status --short                                      build        2×     2m
 *   ● echo "---"  (3 hyphens)                               general        1×     5m
 *
 *   Learning  3 commands                                      agent  approved   last
 *   ○ git status --short                                    general    2 of 3     2m
 *   ○ git push origin feat/trust  dangerous                   build    5 of 8     2d
 *   + 4 more approved once · [a] lists them
 *
 *   ─────────────────────────────────────────────────────────────────────────────────────────
 *   Exactly    echo "---"  — "---" is 3 hyphens, which some fonts draw as one line
 *   Answers    this exact text, for general. Unused for 30 days, it is forgotten.
 *   Still asks echo · echo "---" > out.txt
 *   [x] Revoke   [w] Trust Any echo   [c] Copy As Config   [a] Show All   [p] Pause   [esc] Close
 *
 * **Two sections, by what a rule does for you now.** One list sorted trusted-then-counting, with a
 * `trusted` or `2/3` on every row, made you read each row to learn which kind it was (a user's
 * screenshots). So the answers are one section, newest first — what Trust is doing for you right now —
 * and the rules still counting another, closest to trusted first. A command earned by one agent and
 * still counting for another is a row in each: both rows are true, and `x` acts on the row you are on.
 *
 * **Colour is the mark, not the row.** A filled dot in the success tone is a rule that answers; a
 * hollow muted ring one still counting; `dangerous` in the error tone. Agents, counts and times are
 * muted words in columns headed by what they mean (`approved 2 of 3`), so the commands are what the
 * eye reads first. An agent column that would say the same thing on every row is left out.
 *
 * **Families** (family.ts) group a section's rules: `ls -la`, `ls -x` and `ls -R docs` are all `ls`.
 * A family of one rule is drawn as that one row; families start folded, and `enter` opens one.
 *
 * **The panel** under the list says what the selected line is, one labelled row per fact — what it
 * is exactly, what it answers or how far it has to go, and what still asks or how to stop it — with
 * every argument quoted, and one a font could merge (`---`) said in words.
 */

import { closeHint, fitHints, GLYPH, type Hint, labelCase } from "@opencode-cockpit/client/design"
import {
  anyOf,
  familyOf,
  narrower,
  outside,
  readSubject,
  redirected,
  showSubject,
  spelledSubject,
  spelledWords,
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
import { ago, cut, filled, fit, type Row, type Run, spread, type Tone, widthOf } from "./rows.ts"

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

/* ─── the model: sections, families, rules, lines ────────────────────────────────────────────── */

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

/**
 * The two halves of the list. `answers`: what Trust answers for you now, by its own count or through
 * a family you widened. `learning`: what it is still counting.
 */
export type Section = "answers" | "learning"

const sectionOf = (stand: Stand): Section => (stand.kind === "counting" ? "learning" : "answers")

/** How many approvals a rule still needs; an expired count is last, whatever its streak was. */
const distance = (stand: Stand) =>
  stand.kind !== "counting" ? 0 : stand.expired ? Number.MAX_SAFE_INTEGER : stand.need - stand.have

/** One command in one section, with every agent that stands there for it — the closest first. */
export interface RuleGroup {
  key: string
  section: Section
  permission: string
  subject: string
  family: string
  entries: Entry[]
  lastAt: number
}

export interface FamilyGroup {
  key: string
  section: Section
  permission: string
  family: string
  /** Answers newest first; counting rules closest to trusted first. */
  rules: RuleGroup[]
  /** The agents you trusted the whole family for. */
  widened: Widened[]
  lastAt: number
}

export type Line =
  /** `fold` is what the dialog's open set holds: a family folds per section. */
  | { kind: "family"; key: string; fold: string; family: FamilyGroup; open: boolean }
  | { kind: "rule"; key: string; fold: string; family: FamilyGroup; rule: RuleGroup; nested: boolean }
  | { kind: "always"; key: string; always: Always }

const foldOf = (family: FamilyGroup) => `${family.section}:${family.key}`

/** The section a line is drawn in; OpenCode's own approvals are a third, under their own heading. */
export const sectionOfLine = (line: Line): Section | "always" =>
  line.kind === "always" ? "always" : line.family.section

/**
 * The rules' items grouped into families per section, answers first — with every widened family in
 * the answers, even one with no rule left.
 */
export function ledgerFamilies(items: readonly LedgerItem[], reading: Reading): FamilyGroup[] {
  const rules = new Map<string, RuleGroup>()
  const stands = new Map<Entry, Stand>()
  for (const item of items) {
    if (item.kind !== "rule") continue
    const { entry } = item
    const stand = standOf(entry, reading)
    stands.set(entry, stand)
    const section = sectionOf(stand)
    const key = JSON.stringify([entry.permission, entry.subject])
    const found = rules.get(`${section}:${key}`)
    if (found) {
      found.entries.push(entry)
      found.lastAt = Math.max(found.lastAt, entry.lastAt)
    } else
      rules.set(`${section}:${key}`, {
        key,
        section,
        permission: entry.permission,
        subject: entry.subject,
        family: familyOf(entry.permission, entry.subject),
        entries: [entry],
        lastAt: entry.lastAt,
      })
  }
  const far = (entry: Entry) => distance(stands.get(entry) ?? standOf(entry, reading))
  const families = new Map<string, FamilyGroup>()
  const familyFor = (section: Section, permission: string, family: string) => {
    const key = JSON.stringify([permission, family])
    let found = families.get(`${section}:${key}`)
    if (!found) {
      found = { key, section, permission, family, rules: [], widened: [], lastAt: 0 }
      families.set(`${section}:${key}`, found)
    }
    return found
  }
  for (const rule of rules.values()) {
    rule.entries.sort((a, b) => far(a) - far(b) || b.lastAt - a.lastAt)
    const family = familyFor(rule.section, rule.permission, rule.family)
    family.rules.push(rule)
    family.lastAt = Math.max(family.lastAt, rule.lastAt)
  }
  for (const widened of reading.state.widened.values()) {
    const family = familyFor("answers", widened.permission, widened.family)
    family.widened.push(widened)
    family.lastAt = Math.max(family.lastAt, widened.at)
  }
  /** A family still counting knows it is widened too, so `w` on it offers to undo rather than redo. */
  for (const family of families.values())
    if (family.section === "learning")
      family.widened = [...reading.state.widened.values()].filter(
        (each) => each.permission === family.permission && each.family === family.family,
      )
  const closest = (rule: RuleGroup) => far(rule.entries[0] as Entry)
  for (const family of families.values())
    family.rules.sort((a, b) =>
      family.section === "answers" ? b.lastAt - a.lastAt : closest(a) - closest(b) || b.lastAt - a.lastAt,
    )
  const answers = [...families.values()]
    .filter((family) => family.section === "answers")
    .sort((a, b) => b.lastAt - a.lastAt)
  const learning = [...families.values()]
    .filter((family) => family.section === "learning")
    .sort(
      (a, b) => Math.min(...a.rules.map(closest)) - Math.min(...b.rules.map(closest)) || b.lastAt - a.lastAt,
    )
  return [...answers, ...learning]
}

/** A family drawn as its one row: one rule, and nothing widened that a heading would have to say. */
const single = (family: FamilyGroup) =>
  family.rules.length === 1 && (family.section === "learning" || family.widened.length === 0)

export interface LedgerModel {
  lines: Line[]
  /** Commands approved once, folded into one line (`ledgerShown`). */
  folded: number
}

/**
 * What the dialog lists, in order: the answers, then what is still counting — each family open or
 * not — then OpenCode's own approvals. `open` holds the `fold` of each family opened.
 */
export function ledgerModel(reading: Reading & { all: boolean; open: ReadonlySet<string> }): LedgerModel {
  const { items, folded } = ledgerShown(
    ledgerItems(reading.state, reading.settings, reading.now),
    reading.settings,
    reading.now,
    reading.all,
  )
  const lines: Line[] = []
  for (const family of ledgerFamilies(items, reading)) {
    const fold = foldOf(family)
    if (single(family)) {
      const rule = family.rules[0] as RuleGroup
      lines.push({ kind: "rule", key: `r:${rule.section}:${rule.key}`, fold, family, rule, nested: false })
      continue
    }
    const open = reading.open.has(fold)
    lines.push({ kind: "family", key: `f:${fold}`, fold, family, open })
    if (open)
      for (const rule of family.rules)
        lines.push({ kind: "rule", key: `r:${rule.section}:${rule.key}`, fold, family, rule, nested: true })
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

/** One line's parts: the left grows and gives way, the three on the right are columns of words. */
interface Cells {
  left: Run[]
  agent: string
  status: string
  when: string
}

/** `bash` is every command; any other permission names itself, quietly, before its subject. */
const prefix = (permission: string): Run[] =>
  permission === "bash" ? [] : [{ text: `${permission} `, tone: "muted" }]

const distinct = (values: readonly string[]) => [...new Set(values)]

/** `5m`, `2h`, `now`: under a column headed `last`, the `ago` on every row said nothing. */
const since = (ms: number) => ago(ms).replace(/ ago$/, "")

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

/** `  (3 hyphens)`, muted, after a command a font could misdraw; nothing otherwise. */
function spelledRuns(permission: string, subject: string): Run[] {
  const said = spelledSubject(permission, subject)
  return said ? [{ text: `  (${said})`, tone: "muted" }] : []
}

const dangerRuns = (danger: string | undefined): Run[] =>
  danger ? [{ text: "  dangerous", tone: "error" }] : []

const autosOf = (entries: readonly Entry[]) => entries.reduce((sum, entry) => sum + entry.autos, 0)

/** Under `answered`: `12×`, or `not yet` for a rule earned and not needed since — `0×` read as broken. */
const answered = (count: number) => (count > 0 ? `${count}×` : "not yet")

/** Under `approved`: `2 of 3` for the rule's closest agent. */
function progress(rule: RuleGroup | undefined, reading: Reading): string {
  const stand = rule?.entries[0] ? standOf(rule.entries[0], reading) : undefined
  return stand?.kind === "counting" ? `${stand.have} of ${stand.need}` : ""
}

function ruleCells(rule: RuleGroup, nested: boolean, reading: Reading): Cells {
  const lead = rule.entries[0] as Entry
  const stand = standOf(lead, reading)
  const answers = rule.section === "answers"
  return {
    left: [
      { text: nested ? "   " : " " },
      answers ? { text: `${GLYPH.dot} `, tone: "success" } : { text: `${GLYPH.ring} `, tone: "muted" },
      ...prefix(rule.permission),
      { text: showSubject(rule.permission, rule.subject), tone: "text" },
      ...spelledRuns(rule.permission, rule.subject),
      /** Answered without ever being approved itself: the sidebar says it the same way. */
      ...(stand.kind === "widened" && !nested
        ? [{ text: ` · ${anyOf(rule.permission, stand.family)}`, tone: "muted" as const }]
        : []),
      ...dangerRuns(rule.entries.find((entry) => entry.danger)?.danger),
    ],
    agent: rule.entries.map((entry) => entry.agent).join(", "),
    status: answers ? answered(autosOf(rule.entries)) : progress(rule, reading),
    when: since(reading.now - rule.lastAt),
  }
}

/** Every agent named anywhere in a family: its rules' and, in the answers, its widenings'. */
const agentsOf = (family: FamilyGroup) =>
  distinct([
    ...family.rules.flatMap((rule) => rule.entries.map((entry) => entry.agent)),
    ...(family.section === "answers" ? family.widened.map((each) => each.agent) : []),
  ])

function familyCells(family: FamilyGroup, open: boolean, reading: Reading): Cells {
  const count = family.rules.length
  const widened = family.section === "answers" && family.widened.length > 0
  return {
    left: [
      { text: ` ${open ? GLYPH.unfolded : GLYPH.folded} `, tone: "muted" },
      ...prefix(family.permission),
      { text: showSubject(family.permission, family.family), tone: "text", bold: true },
      ...(widened
        ? [{ text: `  ${anyOf(family.permission, family.family)}`, tone: "success" as const }]
        : []),
      ...(count > 0
        ? [{ text: `${widened ? " · " : "  "}${plural(count, "command")}`, tone: "muted" as const }]
        : []),
    ],
    agent: agentsOf(family).join(", "),
    /**
     * Still counting, a heading says how close its closest rule is — what it is sorted by. Blank, the
     * family's place in the list had no reason you could see.
     */
    status:
      family.section === "answers"
        ? answered(autosOf(family.rules.flatMap((rule) => rule.entries)))
        : progress(family.rules[0], reading),
    when: since(reading.now - family.lastAt),
  }
}

function alwaysCells(always: Always, now: number): Cells {
  return {
    left: [
      { text: ` ${GLYPH.warn} `, tone: "warning" },
      ...prefix(always.permission),
      { text: always.patterns.join("  "), tone: "text" },
    ],
    agent: always.agent,
    status: "",
    when: since(now - always.at),
  }
}

function cellsOf(line: Line, reading: Reading): Cells {
  if (line.kind === "always") return alwaysCells(line.always, reading.now)
  if (line.kind === "family") return familyCells(line.family, line.open, reading)
  return ruleCells(line.rule, line.nested, reading)
}

/** The right-hand columns, sized once for the whole list so they read straight down every section. */
interface Columns {
  /** 0: one agent everywhere, so the column would say the same word on every row. */
  agent: number
  status: number
  /** 0: too narrow to say when. */
  when: number
}

const HEADS: Record<Section | "always", { title: string; status: string }> = {
  answers: { title: "Answers for you", status: "answered" },
  learning: { title: "Learning", status: "approved" },
  always: { title: `OpenCode's own "always"`, status: "" },
}
const PAUSED_ANSWERS = "Would answer, once resumed"
const AGENT_HEAD = "agent"
const WHEN_HEAD = "last"
/** An agent column wider than this is cut: two agents' names, not the command's room. */
const AGENT_MAX = 16

function columnsOf(
  cells: readonly Cells[],
  sections: ReadonlySet<Section | "always">,
  width: number,
): Columns {
  const many = distinct(cells.flatMap((each) => each.agent.split(", ")).filter(Boolean)).length > 1
  const heads = [...sections].map((section) => HEADS[section].status)
  const columns: Columns = {
    agent: many
      ? Math.min(AGENT_MAX, Math.max(AGENT_HEAD.length, ...cells.map((each) => each.agent.length)))
      : 0,
    status: Math.max(0, ...heads.map((head) => head.length), ...cells.map((each) => each.status.length)),
    when: Math.max(WHEN_HEAD.length, ...cells.map((each) => each.when.length)),
  }
  /** The command is what the list is for: the columns give way to it, the agents first. */
  const right = (c: Columns) => (c.agent ? c.agent + 2 : 0) + c.status + 2 + (c.when ? c.when + 2 : 0) + 1
  if (width - right(columns) < 28) columns.agent = 0
  if (width - right(columns) < 20) columns.when = 0
  return columns
}

function rightRuns(agent: string, status: string, when: string, columns: Columns, tone: Tone): Run[] {
  return [
    ...(columns.agent ? [{ text: `  ${cut(agent, columns.agent).padEnd(columns.agent)}`, tone }] : []),
    { text: `  ${status.padStart(columns.status)}`, tone },
    ...(columns.when ? [{ text: `  ${when.padStart(columns.when)}`, tone }] : []),
    { text: " " },
  ]
}

function rowOf(cells: Cells, columns: Columns, width: number): Row {
  return spread(cells.left, rightRuns(cells.agent, cells.status, cells.when, columns, "muted"), width)
}

/** A section's heading: its name and size, and the columns' names over the columns they name. */
function headingRow(
  section: Section | "always",
  count: number,
  columns: Columns,
  width: number,
  paused: boolean,
): Row {
  const head = HEADS[section]
  /** Paused, Trust answers nothing: "Answers for you" would be the one untrue line on the screen. */
  const title = paused && section === "answers" ? PAUSED_ANSWERS : head.title
  return spread(
    [
      { text: ` ${title}`, tone: "text", bold: true },
      ...(count > 0
        ? [
            {
              text: `  ${plural(count, section === "always" ? "approval" : "command")}`,
              tone: "muted" as const,
            },
          ]
        : []),
    ],
    rightRuns(AGENT_HEAD, head.status, WHEN_HEAD, columns, "muted"),
    width,
  )
}

/* ─── the panel: exactly what it is ──────────────────────────────────────────────────────────── */

/** Rows the panel always takes, so moving the cursor never moves the list. */
export const PANEL_ROWS = 3
/** `Still asks` and two spaces: the longest label, kept apart from a command that follows it. */
const LABEL = 12

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
   * first word is the one that did not fit there. The space the row's end lost goes back between them,
   * or the cut read `anotherprog…`.
   */
  kept[max - 1] = [...(kept[max - 1] as Row), { text: " " }, ...rest]
  return kept.map((line) => fit(line, width))
}

/** One labelled fact in the panel. */
export interface Said {
  label: string
  runs: Run[]
}

const muted = (text: string): Run => ({ text, tone: "muted" })
const plain = (text: string): Run => ({ text, tone: "text" })
const key = (name: string): Run => ({ text: `[${name}]`, tone: "accent", bold: true })

/** What a widening never covers, in words — the same three `family.outside` holds back. */
const EXCEPT = "except dangerous ones, ones that write a file and ones that run another program"
const NOT_COVERED = "dangerous ones, and any that write a file or run another program"

const agentsText = (agents: readonly string[]) =>
  agents.length <= 1 ? (agents[0] ?? "") : `${agents.slice(0, -1).join(", ")} and ${agents.at(-1)}`

/** `just now`, `15m ago`. */
const when = (ms: number) => {
  const said = ago(ms)
  return said === "now" ? "just now" : said
}

/** The exact text, and — when a font could draw it as something else — what it is in words. */
function exactly(permission: string, subject: string): Said {
  const spelled = spelledWords(permission, subject)
  return {
    label: "Exactly",
    runs: [
      ...prefix(permission),
      plain(showSubject(permission, subject)),
      ...(spelled.length > 0
        ? [
            muted(
              `  — ${spelled.map((each) => `${each.word} is ${each.said}`).join(", ")}, which some fonts draw as one line`,
            ),
          ]
        : []),
    ],
  }
}

/** What still asks once a command is trusted exactly: a smaller one, and the same into a file. */
function stillAsks(rule: RuleGroup): Run[] {
  if (rule.permission === "edit") return [muted("any other file")]
  if (rule.permission !== "bash") return [muted(`any other ${rule.permission}`)]
  const examples = [narrower(rule.subject), redirected(rule.subject)].filter(
    (each): each is string => each !== undefined,
  )
  const runs: Run[] = []
  examples.forEach((example, index) => {
    if (index > 0) runs.push(muted(" · "))
    runs.push(plain(example))
  })
  runs.push(muted(examples.length > 0 ? " · any other argument" : "any other argument"))
  return runs
}

/** The same command in the other section, for another agent: said, since it is a row elsewhere. */
function elsewhere(rule: RuleGroup, reading: Reading): Run[] {
  const others = [...reading.state.entries.values()].filter(
    (entry) =>
      entry.permission === rule.permission &&
      entry.subject === rule.subject &&
      (entry.approvals > 0 || entry.autos > 0) &&
      !rule.entries.includes(entry),
  )
  return others.map((entry) => {
    const stand = standOf(entry, reading)
    return muted(
      stand.kind === "counting"
        ? ` Still learning for ${entry.agent}: ${stand.have} of ${stand.need}.`
        : ` Also answered for ${entry.agent}.`,
    )
  })
}

function answerSaid(rule: RuleGroup, reading: Reading): Said[] {
  const lead = rule.entries[0] as Entry
  const stand = standOf(lead, reading)
  const agents = agentsText(rule.entries.map((entry) => entry.agent))
  if (stand.kind === "widened")
    return [
      exactly(rule.permission, rule.subject),
      {
        label: "Answers",
        runs: [
          muted("through "),
          plain(anyOf(rule.permission, stand.family)),
          muted(`, the family you widened for ${agents}.`),
          ...elsewhere(rule, reading),
        ],
      },
      { label: "Still asks", runs: [muted(`${NOT_COVERED}.`)] },
    ]
  const { expireDays } = reading.settings
  return [
    exactly(rule.permission, rule.subject),
    {
      label: "Answers",
      runs: [
        muted(`this exact text, for ${agents}.`),
        ...elsewhere(rule, reading),
        ...(expireDays > 0 ? [muted(` Forgotten after ${expireDays} days unused.`)] : []),
      ],
    },
    { label: "Still asks", runs: stillAsks(rule) },
  ]
}

function learningSaid(rule: RuleGroup, reading: Reading): Said[] {
  const lead = rule.entries[0] as Entry
  const stand = standOf(lead, reading)
  if (stand.kind !== "counting") return [exactly(rule.permission, rule.subject)]
  const { threshold, expireDays } = reading.settings
  const left = stand.need - stand.have
  const others = rule.entries.slice(1).map((entry) => {
    const each = standOf(entry, reading)
    return muted(each.kind === "counting" ? ` ${entry.agent}: ${each.have} of ${each.need}.` : "")
  })
  const approved: Said = {
    label: "Approved",
    runs: [
      muted(
        stand.expired
          ? `unused over ${expireDays} days, so it counts again from 0 of ${stand.need}, as ${lead.agent}.`
          : `${stand.have} of ${stand.need} in a row, as ${lead.agent} — ${plural(left, "more approval")} and Trust answers it.`,
      ),
      ...others,
      ...elsewhere(rule, reading),
    ],
  }
  const can = widenable(rule.permission, rule.family)
  if (lead.danger)
    return [
      exactly(rule.permission, rule.subject),
      approved,
      {
        label: "Dangerous",
        runs: [
          muted(
            `${lead.danger} — ${stand.need} in a row instead of ${threshold}${
              rule.permission === "bash" && !can.ok ? ", and never widened as a family" : ""
            }.`,
          ),
        ],
      },
    ]
  /** In a widened family, but one of the commands a widening leaves to its own count. */
  const why = outside(rule.permission, rule.subject)
  if (reading.state.widened.has(keyOf(rule.permission, lead.agent, rule.family)) && why !== undefined)
    return [
      exactly(rule.permission, rule.subject),
      approved,
      {
        label: "Widened",
        runs: [muted("but "), plain(anyOf(rule.permission, rule.family)), muted(` leaves it out: ${why}.`)],
      },
    ]
  return [
    exactly(rule.permission, rule.subject),
    approved,
    {
      label: "Then",
      runs: [muted("Trust answers only this exact text. One reject starts the count over.")],
    },
  ]
}

/** The agent `w` widens a family for: the one on its best rule, unless it is widened already. */
function widenAgent(family: FamilyGroup, line: Line): string | undefined {
  if (line.kind === "rule") return line.rule.entries[0]?.agent
  return family.rules[0]?.entries[0]?.agent ?? family.widened[0]?.agent
}

/** What `w` would do on this line, as the panel's last row. */
function widenSaid(family: FamilyGroup, line: Line): Said {
  const can = widenable(family.permission, family.family)
  if (!can.ok) return { label: "Widen", runs: [muted(`never: ${can.why}.`)] }
  const agent = widenAgent(family, line) ?? "this agent"
  const others = agentsOf(family).filter((each) => each !== agent)
  const except = family.permission === "edit" ? "not its subfolders" : EXCEPT
  return {
    label: "Widen",
    runs: [
      key("w"),
      muted(" answers "),
      plain(anyOf(family.permission, family.family)),
      muted(` for ${agent}, ${except}.`),
      ...(others.length > 0
        ? [muted(` ${agentsText(others)} ${others.length === 1 ? "keeps its" : "keep their"} own count.`)]
        : []),
    ],
  }
}

function listOf(family: FamilyGroup, what: string): Said {
  return {
    label: "Family",
    runs: [
      ...prefix(family.permission),
      plain(showSubject(family.permission, family.family)),
      muted(` · ${plural(family.rules.length, "command")} ${what}: `),
      ...family.rules.flatMap((rule, index) => [
        ...(index > 0 ? [muted(" · ")] : []),
        plain(showSubject(rule.permission, rule.subject)),
      ]),
    ],
  }
}

function familySaid(family: FamilyGroup, line: Line, reading: Reading): Said[] {
  if (family.section === "learning") {
    const best = family.rules[0]
    const stand = best ? standOf(best.entries[0] as Entry, reading) : undefined
    return [
      listOf(family, "still counting"),
      ...(best && stand?.kind === "counting"
        ? [
            {
              label: "Closest",
              runs: [
                plain(showSubject(best.permission, best.subject)),
                muted(`, ${stand.have} of ${stand.need}.`),
              ],
            },
          ]
        : []),
      widenSaid(family, line),
    ]
  }
  if (family.widened.length === 0) return [listOf(family, "answered"), widenSaid(family, line)]
  const at = Math.max(...family.widened.map((each) => each.at))
  return [
    {
      label: "Widened",
      runs: [
        plain(anyOf(family.permission, family.family)),
        muted(
          ` for ${agentsText(family.widened.map((each) => each.agent))} — you widened it ${when(reading.now - at)}.`,
        ),
      ],
    },
    {
      label: "Still asks",
      runs: [muted(family.permission === "edit" ? "files in its subfolders." : `${NOT_COVERED}.`)],
    },
    {
      label: "To stop",
      runs: [
        key("w"),
        muted(" back to exact rules   "),
        key("x"),
        muted(
          ` revokes it${family.rules.length > 0 ? ` and its ${plural(family.rules.length, "rule")}` : ""}`,
        ),
      ],
    },
  ]
}

/** What the panel says about a line: one labelled row per fact, at most `PANEL_ROWS`. */
export function explain(line: Line, reading: Reading): Said[] {
  if (line.kind === "always") {
    const bash = line.always.permission === "bash"
    return [
      { label: "Always", runs: [...prefix(line.always.permission), plain(line.always.patterns.join("  "))] },
      {
        label: "Means",
        runs: [
          muted(
            `OpenCode answers ${bash ? "every command that starts this way" : "everything these match"} for ${
              line.always.agent
            } — not only the one you approved.`,
          ),
        ],
      },
      {
        label: "Until",
        runs: [muted("OpenCode restarts. Trust cannot take it back: restarting OpenCode ends it.")],
      },
    ]
  }
  if (line.kind === "family") return familySaid(line.family, line, reading)
  return line.rule.section === "answers" ? answerSaid(line.rule, reading) : learningSaid(line.rule, reading)
}

function panelRows(line: Line | undefined, reading: Reading, width: number): Row[] {
  if (!line) return Array.from({ length: PANEL_ROWS }, () => fit([], width))
  const said = explain(line, reading).slice(0, PANEL_ROWS)
  const room = Math.max(1, width - 1 - LABEL - 1)
  /** Every fact gets a row; the rows left over go to the first that needs them — the command, first. */
  const need = said.map((each) => wrapRuns(each.runs, room, PANEL_ROWS).length)
  const give = said.map(() => 1)
  let spare = PANEL_ROWS - said.length
  said.forEach((_, index) => {
    while (spare > 0 && (give[index] as number) < (need[index] as number)) {
      give[index] = (give[index] as number) + 1
      spare--
    }
  })
  const rows = said.flatMap((each, index) =>
    wrapRuns(each.runs, room, give[index] as number).map((row, at) =>
      fit([{ text: ` ${(at === 0 ? each.label : "").padEnd(LABEL)}`, tone: "muted" }, ...row], width),
    ),
  )
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
  /** A rule still counting has no trust to revoke: `x` forgets its count, and says so. */
  if (line)
    hints.push({
      key: "x",
      label: line.kind !== "always" && line.family.section === "learning" ? "Forget" : "Revoke",
      priority: 5,
      ...(line.kind === "always" ? { off: true } : {}),
    })
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
  if (line) hints.push({ key: "c", label: "Copy As Config", priority: 1 })
  /** Above copying: it changes what the list shows, and a key that does that must be findable. */
  if (input.folded) hints.push({ key: "a", label: "Show All", priority: 2 })
  else if (input.all) hints.push({ key: "a", label: "Show Fewer", priority: 2 })
  /**
   * Above listing and copying: "how do I stop it" is one of the questions the dialog is opened with,
   * and the fold row already says `[a]` where the commands it lists are.
   */
  hints.push({ key: "p", label: input.state.paused ? "Resume" : "Pause", priority: 3 })
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
  /** The first body row drawn, so the caller can keep the cursor in view on the next draw. */
  top: number
  /** The line under the cursor, as drawn: the caller's actions act on it. */
  line?: Line
}

/** The commands approved once, under what is still counting: one quiet row, and the key that lists them. */
function foldRow(count: number, width: number): Row {
  return fit([muted(` + ${count} more approved once · `), key("a"), muted(" lists them")], width)
}

/** What a section holds: a family heading counts its rules, a row in an open family is already counted. */
function countOf(lines: readonly Line[]): number {
  return lines.reduce(
    (sum, line) =>
      sum + (line.kind === "family" ? line.family.rules.length : line.kind === "rule" && line.nested ? 0 : 1),
    0,
  )
}

/** Header and gap above the list; the edge marker, the rule, the panel and the keys below it. */
const CHROME = 2 + 1 + 1 + PANEL_ROWS + 1

export function ledgerRows(input: LedgerInput): LedgerView {
  const { width, lines, state, settings, now } = input
  const reading: Reading = { state, settings, now }
  const rows: Row[] = []
  /** Whether Trust is answering at all is the first thing to know; paused is the one state worth a colour. */
  rows.push(
    spread(
      [{ text: " Trust in this project", tone: "text", bold: true }],
      [
        state.paused
          ? { text: "paused — counting, answering nothing", tone: "warning", bold: true }
          : { text: "on", tone: "muted" },
        { text: " " },
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

  /** The body: each section under its heading, a row of air between them. */
  /** `section`: a heading, named again in the `↓` row when it is below the window. */
  const body: { row: Row; line?: number; section?: string }[] = []
  const folded = input.folded ?? 0
  if (lines.length === 0 && folded === 0) {
    const said = wrapRuns(
      [
        muted(
          `Nothing learned yet. Approve the same command ${settings.threshold} times in a row and Trust answers it for you from then on — that exact command, for that agent. A dangerous one takes ${settings.threshold + settings.dangerExtra}.`,
        ),
      ],
      Math.max(1, width - 2),
      3,
    )
    for (const each of said) body.push({ row: fit([{ text: " " }, ...each], width) })
  } else {
    const cells = lines.map((each) => cellsOf(each, reading))
    const sections = new Set(lines.map(sectionOfLine))
    sections.add("answers")
    if (folded > 0) sections.add("learning")
    const columns = columnsOf(cells, sections, width)
    const drawSection = (section: Section | "always") => {
      const at = lines.flatMap((each, i) => (sectionOfLine(each) === section ? [i] : []))
      if (at.length === 0 && section !== "answers" && !(section === "learning" && folded > 0)) return
      if (body.length > 0) body.push({ row: fit([], width) })
      body.push({
        row: headingRow(section, countOf(at.map((i) => lines[i] as Line)), columns, width, state.paused),
        section: section === "always" ? `OpenCode's "always"` : HEADS[section].title,
      })
      if (section === "answers" && at.length === 0)
        body.push({
          row: fit(
            [
              muted(
                `   Nothing yet: ${settings.threshold} approvals in a row and Trust answers a command for you.`,
              ),
            ],
            width,
          ),
        })
      for (const i of at) {
        const row = rowOf(cells[i] as Cells, columns, width)
        body.push({
          row:
            i === index
              ? /** `▌` in the margin cell is the cursor in every bay; the fill reaches both edges. */
                filled(fit([{ text: GLYPH.cursor, tone: "accent" }, ...trimLead(row)], width), "selected")
              : row,
          line: i,
        })
      }
      if (section === "learning" && folded > 0) body.push({ row: foldRow(folded, width) })
    }
    drawSection("answers")
    drawSection("learning")
    drawSection("always")
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
   * a list cut at the window's edge otherwise looks like the whole list. Counted in lines you can
   * move to, not in headings and air.
   */
  const above = body.slice(0, top).filter((each) => each.line !== undefined).length
  const after = body.slice(top + room)
  const below = after.filter((each) => each.line !== undefined).length
  /**
   * In a short window the whole of what is counting can be below the edge; a bare count did not say
   * there was a second section at all.
   */
  const hidden = after.flatMap((each) => (each.section ? [each.section] : []))
  if (top > 0) rows[1] = fit([muted(above > 0 ? ` ↑ ${above} more above` : "")], width)
  for (const each of shown) rows.push(each.row)
  while (rows.length < 2 + room) rows.push(fit([], width))
  rows.push(
    fit(
      below > 0 ? [muted(` ↓ ${below} more below${hidden.length > 0 ? ` · ${hidden.join(", ")}` : ""}`)] : [],
      width,
    ),
  )
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

/** A row without its first cell, so the cursor can take the margin it was drawn with. */
function trimLead(row: Row): Row {
  const [first, ...rest] = row
  if (!first) return row
  return first.text.length > 1 ? [{ ...first, text: first.text.slice(1) }, ...rest] : rest
}

/* ─── acting on a line ───────────────────────────────────────────────────────────────────────── */

export interface Outcome {
  /** To append to the ledger: nothing is ever changed in place. */
  events: Event[]
  notice: { text: string; tone: Tone }
}

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
 * `x`: a rule loses its standing for every agent on its row. A heading in the answers loses every
 * rule that answers in its family, and its widening; one still counting loses every count in its
 * family — the ones folded away as approved once too. A row is in one section, so `x` never reaches
 * into the other: revoking what Trust answers does not also forget what it is counting.
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
  const learning = line.family.section === "learning"
  if (line.kind === "rule") {
    const { rule } = line
    const name = showSubject(rule.permission, rule.subject)
    const agents = rule.entries.map((entry) => entry.agent)
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
        text: learning
          ? `Forgot the count for ${name}${agents.length > 1 ? ` (${agentsText(agents)})` : ""}: it starts again from 0.`
          : `Revoked: ${name} is asked again until you approve it ${threshold}× more${
              agents.length > 1 ? ` — for ${agentsText(agents)}` : ""
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
      familyOf(entry.permission, entry.subject) === family.family &&
      (standOf(entry, reading).kind === "counting") === learning,
  )
  const subjects = distinct(entries.map((entry) => entry.subject)).length
  const widened = learning ? [] : family.widened
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
    ...widened.map(
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
      text: learning
        ? `Forgot ${plural(subjects, "count")} in ${name}: each starts again from 0.`
        : `Revoked ${plural(subjects, "rule")} in ${name}${
            widened.length > 0 ? ", and its widening" : ""
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
