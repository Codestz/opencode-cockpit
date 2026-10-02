/**
 * The ledger, behind `l`: every rule Trust holds, as a tree of families, and a card that explains the
 * one selected — always on screen, so there is no details key to find.
 *
 *    Trust · opencode-cockpit             11 trusted · 14 learning · 101 seen once   ● answering
 *   ────────────────────────────────────────┬─────────────────────────────────────────────────────
 *    FAMILIES                      / filter │  head -30
 *    ▾ head           1 ✓  5 ○              │  ✓ Trusted for  general  · ready, not used yet
 *   ▌    head -30          ✓ trusted        │
 *        head -40          ▰▰▱ 2 of 3       │  Exactly     head -30
 *        + 3 more                           │  Still asks  head -31 · head -30 > out.txt
 *    ▸ git status     1 ✓  1 ○              │  History     ✓ 9h  ✓ 9h  ✓ 9h  → trusted
 *      ls -la              ✓ trusted 1×     │              3 approvals in a row, all yours
 *      git push …      !  ▰▰▰▰▰▱▱▱ 5 of 8   │  Family      head · 6 commands, 1 trusted
 *    ! OpenCode always    2 broad rules     │   x  Revoke    w  Trust any head    c  Copy rule
 *   ────────────────────────────────────────┴─────────────────────────────────────────────────────
 *    [↑/↓] Move   [←/→] Fold   [tab] Card   [/] Filter   [p] Pause   [?] Keys   [esc] Back
 *
 * **A command is one row.** The list it replaced split a family into what answers and what learns, so
 * `head -30` was in one section while `head` was in the other, and the details repeated. Here a family
 * is one fold, like a folder in an editor, and a command one row in it whatever its agents say; the
 * card lists each agent's standing.
 *
 * **The card is the explanation.** The command whole, on a raised panel; where each agent stands; the
 * exact text and what still asks; the approvals that earned it (history.ts); its family and what `w`
 * would do; and the actions as buttons you can click or reach with `tab`.
 *
 * Below about ninety columns the card moves under the tree, the selection kept in view above it.
 */

import { closeHint, type Hint } from "@opencode-cockpit/client/design"
import { anyOf, narrower, outside, redirected, showSubject, spelledWords, widenable } from "../family.ts"
import { earned, type History, type Mark } from "../history.ts"
import { keyOf, type Thresholds } from "../ledger.ts"
import { NOT_COVERED, revokeLabel, type Target, widenLabel, widenScope } from "./actions.ts"
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
  type Standing,
} from "./model.ts"
import {
  agentsText,
  badge,
  button,
  buttonHits,
  chip,
  footerRow,
  type Hit,
  headerRow,
  type KeyLine,
  keyListBody,
  meter,
  muted,
  plain,
  plural,
  since,
  when,
  wrapRuns,
} from "./parts.ts"
import { cursorRow, filled, fit, type Row, type Run, rowText, spread, type Tone, widthOf } from "./rows.ts"

/* ─── the tree ───────────────────────────────────────────────────────────────────────────────── */

export type Node =
  | { kind: "family"; key: string; family: Family; open: boolean }
  | { kind: "command"; key: string; command: Command; family: Family; nested: boolean }
  /** The folded tail of an open family: `+ 3 more`. */
  | { kind: "more"; key: string; family: Family; hidden: number }
  | { kind: "always"; key: string; groups: AlwaysGroup[] }

export interface Tree {
  /** Families opened, by `Family.key`. */
  open: ReadonlySet<string>
  /** Families whose tail is shown too, by `Family.key`. */
  full: ReadonlySet<string>
  /** Only what matches this text, every family with a match open. Empty: everything. */
  filter: string
}

export interface ExplorerModel {
  nodes: Node[]
  families: Family[]
  commands: Command[]
  counts: Counts
}

/** Commands an open family lists before folding the rest into `+ N more`. */
export const TAIL = 3

export const familyNodeKey = (family: Family): string => `f:${family.key}`
export const commandNodeKey = (command: Command): string => `c:${command.key}`
export const ALWAYS_KEY = "o:always"

/** A family drawn as its one command: one command, and no widening a heading would have to say. */
const single = (family: Family) => family.commands.length === 1 && family.widened.length === 0

const commandText = (command: Command) =>
  `${command.permission === "bash" ? "" : `${command.permission} `}${showSubject(command.permission, command.subject)}`
const familyText = (family: Family) =>
  `${family.permission === "bash" ? "" : `${family.permission} `}${showSubject(family.permission, family.family)}`

export function explorerModel(input: Reading & Tree): ExplorerModel {
  const commands = commandsOf(input)
  const families = familiesOf(input, commands)
  const needle = input.filter.trim().toLowerCase()
  const nodes: Node[] = []
  for (const family of families) {
    const named = needle !== "" && familyText(family).toLowerCase().includes(needle)
    const listed =
      needle === "" || named
        ? family.commands
        : family.commands.filter((command) => commandText(command).toLowerCase().includes(needle))
    if (needle !== "" && listed.length === 0 && !named) continue
    if (single(family)) {
      const command = family.commands[0] as Command
      nodes.push({ kind: "command", key: commandNodeKey(command), command, family, nested: false })
      continue
    }
    const open = needle !== "" || input.open.has(family.key)
    nodes.push({ kind: "family", key: familyNodeKey(family), family, open })
    if (!open) continue
    const whole = needle !== "" || input.full.has(family.key) || listed.length <= TAIL + 1
    const shown = whole ? listed : listed.slice(0, TAIL)
    for (const command of shown)
      nodes.push({ kind: "command", key: commandNodeKey(command), command, family, nested: true })
    if (!whole)
      nodes.push({ kind: "more", key: `m:${family.key}`, family, hidden: listed.length - shown.length })
  }
  const groups = alwaysGroups(input.state)
  if (
    groups.length > 0 &&
    (needle === "" ||
      "opencode always".includes(needle) ||
      groups.some((group) => group.patterns.join(" ").toLowerCase().includes(needle)))
  )
    nodes.push({ kind: "always", key: ALWAYS_KEY, groups })
  return { nodes, families, commands, counts: countsOf(commands) }
}

/** What `x`, `w` and `c` act on, for a node. */
export function nodeTarget(node: Node): Target {
  if (node.kind === "always") return { kind: "always", groups: node.groups }
  if (node.kind === "command") return { kind: "command", command: node.command, family: node.family }
  return { kind: "family", family: node.family }
}

/** The tree state that shows `command` with its family open, its tail too when it is folded there. */
export function reveal(
  tree: { open: Set<string>; full: Set<string> },
  families: readonly Family[],
  subject: { permission: string; subject: string },
): string | undefined {
  for (const family of families) {
    const at = family.commands.findIndex(
      (command) => command.permission === subject.permission && command.subject === subject.subject,
    )
    if (at < 0) continue
    if (!single(family)) {
      tree.open.add(family.key)
      if (at >= TAIL && family.commands.length > TAIL + 1) tree.full.add(family.key)
    }
    return commandNodeKey(family.commands[at] as Command)
  }
  return undefined
}

/* ─── a tree row ─────────────────────────────────────────────────────────────────────────────── */

/** The right-hand column of a tree row: how the command stands, or what a family holds. */
function statusRuns(node: Node): Run[] {
  if (node.kind === "more") return []
  if (node.kind === "always")
    return [
      {
        text: plural(
          node.groups.reduce((sum, group) => sum + group.patterns.length, 0),
          "broad rule",
        ),
        tone: "warning",
      },
    ]
  if (node.kind === "family") {
    const trusted = node.family.commands.filter((command) => command.phase === "answering").length
    const learning = node.family.commands.filter((command) => command.phase === "learning").length
    const rest = node.family.commands.length - trusted
    return [
      ...(trusted > 0 ? [{ text: `${trusted} ✓`, tone: "success" as Tone }] : []),
      ...(trusted > 0 && rest > 0 ? [{ text: "  " }] : []),
      ...(rest > 0 ? [{ text: `${rest} ○`, tone: (learning > 0 ? "warning" : "muted") as Tone }] : []),
    ]
  }
  const { command } = node
  const { stand } = leadOf(command)
  const autos = command.standings.reduce((sum, each) => sum + each.entry.autos, 0)
  if (stand.kind === "trusted")
    return [{ text: "✓ trusted", tone: "success" }, ...(autos > 0 ? [muted(` ${autos}×`)] : [])]
  if (stand.kind === "widened")
    return [{ text: "✓ widened", tone: "success" }, ...(autos > 0 ? [muted(` ${autos}×`)] : [])]
  if (stand.expired) return [muted("expired")]
  /** A long meter says its count in the short form, so the command keeps the room. */
  return [
    ...meter(stand.have, stand.need, command.danger !== undefined),
    muted(stand.need > 4 ? ` ${stand.have}/${stand.need}` : ` ${stand.have} of ${stand.need}`),
  ]
}

/**
 * One row of the tree. `statusWidth` is the status column's, `badges` the cells before it kept for a
 * dangerous command's `!` — so every meter and every `✓` starts in the same column.
 */
function treeRow(node: Node, width: number, statusWidth: number, badges: number, selected: boolean): Row {
  let left: Run[]
  if (node.kind === "family") {
    left = [
      muted(` ${node.open ? "▾" : "▸"} `),
      {
        text: familyText(node.family),
        tone:
          node.family.commands.every((c) => c.phase === "once") && node.family.widened.length === 0
            ? "muted"
            : "text",
        bold: true,
      },
      ...(node.family.widened.length > 0 ? [{ text: " " }, badge("any", "success")] : []),
    ]
  } else if (node.kind === "command") {
    const indent = node.nested ? 5 : 3
    left = [
      { text: " ".repeat(indent) },
      {
        text: nestedText(node, width - indent - statusWidth - badges - 3),
        tone: node.command.phase === "once" ? "muted" : "text",
      },
    ]
  } else if (node.kind === "more") left = [muted(`     + ${node.hidden} more`)]
  else left = [{ text: " ! ", tone: "warning" }, plain("OpenCode always")]
  const status = statusRuns(node)
  const danger =
    node.kind === "command" && node.command.danger !== undefined && node.command.phase !== "answering"
  const right: Run[] = [
    ...(danger ? [badge("!", "error"), { text: " " }] : badges > 0 ? [{ text: " ".repeat(badges) }] : []),
    ...status,
  ]
  const padded: Run[] =
    status.length === 0
      ? []
      : [...right, { text: " ".repeat(Math.max(0, statusWidth - widthOf(rowText(status)))) }, { text: " " }]
  const row = padded.length > 0 ? spread(left, padded, width) : fit(left, width)
  return selected ? cursorRow(row, width) : row
}

/**
 * A command under its family's heading, in `room` columns. Cut from the right, two variants of one
 * family read alike (`git status --sho…` twice), so a command that does not fit gives up the family's
 * words first — the heading above already says them: `… --short -uno`.
 */
function nestedText(node: Extract<Node, { kind: "command" }>, room: number): string {
  const text = commandText(node.command)
  if (widthOf(text) <= room || !node.nested) return text
  const family = familyText(node.family)
  return text.startsWith(`${family} `) ? `…${text.slice(family.length)}` : text
}

const statusWidthOf = (nodes: readonly Node[], width: number) =>
  Math.min(Math.floor(width * 0.45), Math.max(0, ...nodes.map((node) => widthOf(rowText(statusRuns(node))))))

/** Cells for the `!` of a dangerous command among `nodes`: its badge and a space, or none. */
const badgesOf = (nodes: readonly Node[]) =>
  nodes.some(
    (node) =>
      node.kind === "command" && node.command.danger !== undefined && node.command.phase !== "answering",
  )
    ? 4
    : 0

/* ─── the card ───────────────────────────────────────────────────────────────────────────────── */

/** `Still asks` and two spaces: the longest label. */
const LABEL = 12

/** One labelled fact on the card: each line wraps on its own. `keep`: higher stays when room is short. */
interface Fact {
  label: string
  lines: Run[][]
  keep: number
  /** The first line is a row of moments: it keeps its newest end on one row rather than wrapping. */
  newest?: boolean
}

/** A fact's rows at `width`: each line wrapped, a row of moments cut from its oldest end. */
function factLines(fact: Fact, width: number): Row[] {
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

interface CardParts {
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
function cardRows(parts: CardParts, width: number, room: number, focus: number | undefined): Row[] {
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
const buttonsAt = (rows: readonly Row[]) =>
  rows.findIndex((row) => row.some((run) => run.fill === "button" || run.fill === "buttonOn"))

/* ─── the screen ─────────────────────────────────────────────────────────────────────────────── */

export interface ExplorerInput extends Reading, Tree {
  width: number
  height: number
  history: History
  project: string
  /** The node under the cursor, by key; the first node when it is not there. */
  selected?: string
  /** `tab` moved into the card: which button is focused. */
  focus?: { button: number }
  /** `/` was pressed: what has been typed so far. */
  typing?: string
  notice?: { text: string; tone: Tone }
  /** `?`: every key, in the body's place. */
  keys?: boolean
}

export interface ExplorerView {
  rows: Row[]
  node?: Node
  model: ExplorerModel
  buttons: Button[]
  hits: Hit[]
  /** Whether the card is beside the tree (true) or under it. */
  wide: boolean
}

/** At this width and wider the card is beside the tree; narrower, under it. */
export const WIDE = 90
export const MIN_HEIGHT = 11

export const EXPLORER_KEYS: readonly KeyLine[] = [
  { keys: ["j/k", "↑/↓"], does: "Move through the families and their commands; the wheel moves too" },
  { keys: ["←/h", "→/l"], does: "Fold or open a family; ← on a command goes to its family" },
  { keys: ["space", "enter"], does: "Open or fold a family, or list the rest of it" },
  { keys: ["tab"], does: "Into the card's buttons, and back; ←/→ choose one, enter presses it" },
  { keys: ["x"], does: "Revoke what answers, or forget a count still learning" },
  { keys: ["w"], does: "Trust any command of the family, or go back to exact rules" },
  { keys: ["c"], does: "Copy the rule as opencode.json config" },
  { keys: ["/"], does: "Filter by text; esc clears it" },
  { keys: ["p"], does: "Pause Trust in this project, or resume it" },
  { keys: ["?", "esc"], does: "Hide these keys; esc goes back to the activity, and closes from there" },
]

const rule = (width: number) => fit([{ text: "─".repeat(width), tone: "border" }], width)

export function explorerRows(input: ExplorerInput): ExplorerView {
  const { width, state } = input
  const height = Math.max(MIN_HEIGHT, input.height)
  const model = explorerModel(input)
  const index = Math.max(
    0,
    model.nodes.findIndex((node) => node.key === input.selected),
  )
  const node = model.nodes[index]
  const reading: CardReading = { ...input, families: model.families }
  const card = node ? cardOf(node, reading) : undefined
  const buttons = card?.buttons ?? []
  const { counts } = model
  const said: Run[] = [
    { text: `${counts.trusted} trusted`, tone: counts.trusted > 0 ? "success" : "muted" },
    muted(" · "),
    { text: `${counts.learning} learning`, tone: counts.learning > 0 ? "warning" : "muted" },
    muted(` · ${counts.once} seen once`),
  ]
  const rows: Row[] = [headerRow(input.project, state.paused, said, width)]
  const hits: Hit[] = []
  const wide = width >= WIDE
  const focus =
    input.focus && buttons.length > 0 ? Math.min(input.focus.button, buttons.length - 1) : undefined

  if (input.keys) {
    rows.push(rule(width))
    rows.push(...keyListBody(EXPLORER_KEYS, width, height - 4))
    rows.push(rule(width))
    rows.push(footerRow([closeHint("Hide Keys")], width))
    return { rows, ...(node ? { node } : {}), model, buttons, hits, wide }
  }

  const body = height - 4
  const treeWidth = wide ? Math.max(34, Math.min(46, Math.round(width * 0.4))) : width
  const cardWidth = wide ? width - treeWidth - 1 : width
  /** Stacked: the card under the tree, as tall as it needs up to a little over half, the tree keeping three rows. */
  const cardNeed = card ? cardHeight(card, cardWidth) : 1
  const cardRoom = wide
    ? body
    : Math.max(3, Math.min(cardNeed, Math.max(6, Math.ceil((body - 1) * 0.55)), body - 1 - 3))
  const treeRoom = wide ? body : body - 1 - cardRoom

  /* the tree: a heading, then a window of nodes around the cursor */
  const listRoom = Math.max(1, treeRoom - 1)
  const top = Math.max(0, Math.min(index - Math.floor(listRoom / 2), model.nodes.length - listRoom))
  const shown = model.nodes.slice(top, top + listRoom)
  const headRight: Run[] =
    input.typing !== undefined
      ? [{ text: `/ ${input.typing}`, tone: "text" }, { text: "▍", tone: "accent" }, { text: " " }]
      : input.filter !== ""
        ? [{ text: `/ ${input.filter}`, tone: "accent" }, { text: " " }]
        : model.nodes.length > listRoom
          ? [muted(`${top + 1}–${top + shown.length} of ${model.nodes.length}`), { text: " " }]
          : [muted("/ filter"), { text: " " }]
  const treeLines: Row[] = [spread([muted(" FAMILIES")], headRight, treeWidth)]
  const statusWidth = statusWidthOf(shown, treeWidth)
  const badges = badgesOf(shown)
  /** Nothing to list: a word in the tree, and in the card — where there is room — what to do about it. */
  const nothing =
    input.filter !== ""
      ? `Nothing matches "${input.filter}". esc clears the filter.`
      : `Nothing learned yet. Approve the same command ${input.settings.threshold} times in a row and Trust answers it for you from then on — that exact command, for that agent. A dangerous one takes ${input.settings.threshold + input.settings.dangerExtra}.`
  if (model.nodes.length === 0)
    treeLines.push(fit([muted(input.filter !== "" ? "   No match." : "   Nothing yet.")], treeWidth))
  for (const each of shown) treeLines.push(treeRow(each, treeWidth, statusWidth, badges, each === node))
  while (treeLines.length < treeRoom) treeLines.push(fit([], treeWidth))

  const cardLines = card
    ? cardRows(card, cardWidth, cardRoom, focus)
    : [
        ...wrapRuns([muted(nothing)], Math.max(1, cardWidth - 3), Math.max(1, cardRoom)).map((row) =>
          fit([{ text: "  " }, ...row], cardWidth),
        ),
        ...Array.from({ length: cardRoom }, () => fit([], cardWidth)),
      ].slice(0, cardRoom)
  const buttonsRow = buttonsAt(cardLines)
  const actions = buttons.map((each) => each.action)

  if (wide) {
    rows.push(fit([{ text: `${"─".repeat(treeWidth)}┬${"─".repeat(cardWidth)}`, tone: "border" }], width))
    for (let i = 0; i < body; i++) {
      rows.push([...(treeLines[i] as Row), { text: "│", tone: "border" }, ...(cardLines[i] as Row)])
      const y = rows.length - 1
      const at = i - 1
      if (i >= 1 && at < shown.length)
        hits.push({ kind: "row", y, key: (shown[at] as Node).key, x0: 0, x1: treeWidth })
      if (i === buttonsRow)
        for (const hit of buttonHits(cardLines[i] as Row, y, actions))
          if (hit.kind === "button")
            hits.push({ ...hit, x0: hit.x0 + treeWidth + 1, x1: hit.x1 + treeWidth + 1 })
    }
    rows.push(
      input.notice
        ? fit([{ text: ` ${input.notice.text}`, tone: input.notice.tone }], width)
        : fit([{ text: `${"─".repeat(treeWidth)}┴${"─".repeat(cardWidth)}`, tone: "border" }], width),
    )
  } else {
    rows.push(rule(width))
    treeLines.forEach((line, i) => {
      rows.push(line)
      const at = i - 1
      if (i >= 1 && at < shown.length)
        hits.push({ kind: "row", y: rows.length - 1, key: (shown[at] as Node).key })
    })
    rows.push(rule(width))
    cardLines.forEach((line, i) => {
      rows.push(line)
      if (i === buttonsRow) hits.push(...buttonHits(line, rows.length - 1, actions))
    })
    rows.push(
      input.notice ? fit([{ text: ` ${input.notice.text}`, tone: input.notice.tone }], width) : rule(width),
    )
  }
  rows.push(footerRow(hintsFor(input, node, focus !== undefined, buttons), width))
  return { rows, ...(node ? { node } : {}), model, buttons, hits, wide }
}

/** Rows the card wants at this width, nothing cut. */
function cardHeight(card: CardParts, width: number): number {
  const textWidth = Math.max(1, width - 2 - LABEL)
  return (
    wrapRuns(card.title, Math.max(1, width - 2), 3).length +
    card.standing.length +
    2 +
    card.facts.reduce((sum, fact) => sum + factLines(fact, textWidth).length, 0) +
    1
  )
}

function hintsFor(
  input: ExplorerInput,
  node: Node | undefined,
  inCard: boolean,
  buttons: readonly Button[],
): Hint[] {
  if (input.typing !== undefined) return [{ key: "enter", label: "Apply", priority: 2 }, closeHint("Cancel")]
  if (inCard)
    return [
      { key: "←/→", label: "Button", priority: 4 },
      { key: "enter", label: "Press", priority: 5 },
      { key: "tab", label: "Tree", priority: 3 },
      closeHint("Back"),
    ]
  const hints: Hint[] = [
    { key: "↑/↓", label: "Move", priority: 6 },
    ...(node && node.kind !== "always" ? [{ key: "←/→", label: "Fold", priority: 4 }] : []),
    ...(buttons.length > 0 ? [{ key: "tab", label: "Card", priority: 3 }] : []),
    { key: "/", label: "Filter", priority: 2 },
    { key: "p", label: input.state.paused ? "Resume" : "Pause", priority: input.state.paused ? 5.5 : 1 },
    { key: "?", label: "Keys", priority: 5 },
    closeHint(input.filter ? "Clear" : "Back"),
  ]
  return hints
}
