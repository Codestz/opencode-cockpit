/**
 * The ledger's tree: what Trust holds, by what was asked — commands, edits, tools and fetches — then
 * by family, a command one row in its family.
 *
 * **Kinds before families.** One list ordered only by standing put `edit packages/api/…` between
 * `git status` and `jq`, and three edits in three folders read as three unrelated rows. Each kind
 * has its own heading now, in a fixed order, and an edit's family — its folder — is always a row of
 * its own under Edits, with how many files it holds.
 *
 * **What was seen once folds away.** Most of a busy ledger is commands approved once and never again
 * (34 of 45 in the project that asked for this), none of them anything to act on yet. Within a kind,
 * every family of them is one `seen once` row that opens like any other; a filter still finds them.
 *
 * **One column, one shape.** Every row ends in the same slot: `✓` trusted, `▰` learning, `○` seen
 * once — counts on a family's row, the standing itself on a command's.
 */

import { dangerOf } from "../danger.ts"
import { readSubject, shown, showSubject } from "../family.ts"
import { type Suggestion, suggestionsOf } from "../suggest.ts"
import type { Target } from "./actions.ts"
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
  stale,
} from "./model.ts"
import { badge, meter, muted, plain, plural } from "./parts.ts"
import { cursorRow, fit, type Row, type Run, rowText, spread, squeeze, type Tone, widthOf } from "./rows.ts"

/** The kinds a ledger is grouped by, in the order they are listed; suggestions above them all. */
export type Section = "suggested" | "commands" | "edits" | "tools"
export const SECTIONS: readonly Section[] = ["commands", "edits", "tools"]
export const SECTION_TITLES: Record<Section, string> = {
  suggested: "SUGGESTED",
  commands: "COMMANDS",
  edits: "EDITS",
  tools: "TOOLS & FETCHES",
}
export const sectionOf = (permission: string): Section =>
  permission === "bash" ? "commands" : permission === "edit" ? "edits" : "tools"

export type Node =
  /** Today's answers, the strip above the tree: selected, the card lists them. */
  | { kind: "today"; key: string; answers: number }
  /** A family Trust suggests widening (suggest.ts): `w` widens it, `d` dismisses it. */
  | { kind: "suggest"; key: string; suggestion: Suggestion }
  /** `depth`: folders above it; `prefix`: the words they already say, left out of its own label. */
  | { kind: "family"; key: string; family: Family; open: boolean; depth: number; prefix: string }
  | {
      kind: "command"
      key: string
      command: Command
      family: Family
      nested: boolean
      depth: number
      prefix: string
    }
  /**
   * Families that share their first words, as one folder: `mcpx`, then `db-local` under it. A folder
   * is for reading only — `w` widens one family, never everything under a folder.
   */
  | {
      kind: "group"
      key: string
      label: string
      depth: number
      prefix: string
      families: Family[]
      open: boolean
    }
  /** The folded tail of an open family: `+ 3 more`. */
  | { kind: "more"; key: string; family: Family; hidden: number; depth: number }
  /** A kind's families seen only once, folded into one row. */
  | { kind: "once"; key: string; section: Section; families: Family[]; open: boolean }
  | { kind: "always"; key: string; groups: AlwaysGroup[] }

/** A row of the tree as drawn: a kind's heading, a row of air, or a node the cursor can stop on. */
export type Line = { kind: "heading"; section: Section } | { kind: "gap" } | { kind: "node"; node: Node }

export interface Tree {
  /** Families opened, by `Family.key`; `seen once` rows too, by their node key. */
  open: ReadonlySet<string>
  /** Families whose tail is shown too, by `Family.key`. */
  full: ReadonlySet<string>
  /** Only what matches this text, every family with a match open. Empty: everything. */
  filter: string
}

export interface ExplorerModel {
  /** Every node the cursor moves over, in screen order: the Today strip first when there is one. */
  nodes: Node[]
  /** The tree as drawn, the Today strip left out (it sits above the tree). */
  lines: Line[]
  families: Family[]
  commands: Command[]
  counts: Counts
}

/** Commands an open family lists before folding the rest into `+ N more`. */
export const TAIL = 3

export const familyNodeKey = (family: Family): string => `f:${family.key}`
export const commandNodeKey = (command: Command): string => `c:${command.key}`
export const onceNodeKey = (section: Section): string => `o:${section}`
export const ALWAYS_KEY = "o:always"
export const TODAY_KEY = "t:today"

/** A family drawn as its one command: one command, and no widening a heading would have to say. Never an edit's folder. */
const single = (family: Family) =>
  family.permission !== "edit" && family.commands.length === 1 && family.widened.length === 0

/** Nothing in it trusted or learning, and nothing widened: a family seen once, folded away. */
const seenOnce = (family: Family) =>
  family.widened.length === 0 && family.commands.every((command) => command.phase === "once")

export const commandText = (command: Command) =>
  `${command.permission === "bash" ? "" : `${command.permission} `}${showSubject(command.permission, command.subject)}`
/** A family as its heading says it: `head`, `read src/`, and a whole tool (`*`) as its name alone — `grep`. */
export const familyText = (family: Family) =>
  family.family === "*"
    ? family.permission
    : `${family.permission === "bash" ? "" : `${family.permission} `}${showSubject(family.permission, family.family)}`

/** A command as its row says it: under Edits the path alone, the heading says what kind it is. */
const rowCommandText = (command: Command) =>
  command.permission === "edit" ? command.subject : commandText(command)
const rowFamilyText = (family: Family) => (family.permission === "edit" ? family.family : familyText(family))

export function explorerModel(input: Reading & Tree & { today?: number }): ExplorerModel {
  const commands = commandsOf(input)
  const families = familiesOf(input, commands)
  const needle = input.filter.trim().toLowerCase()
  const nodes: Node[] = []
  const lines: Line[] = []
  if (input.today !== undefined && needle === "")
    nodes.push({ kind: "today", key: TODAY_KEY, answers: input.today })

  /** A family's nodes: its row (or its one command), and when open its commands and `+ N more`. */
  const familyNodes = (family: Family, listed: readonly Command[], depth = 0, prefix = ""): Node[] => {
    if (single(family)) {
      const command = family.commands[0] as Command
      return [
        { kind: "command", key: commandNodeKey(command), command, family, nested: false, depth, prefix },
      ]
    }
    const open = needle !== "" || input.open.has(family.key)
    const out: Node[] = [{ kind: "family", key: familyNodeKey(family), family, open, depth, prefix }]
    if (!open) return out
    const whole = needle !== "" || input.full.has(family.key) || listed.length <= TAIL + 1
    const kept = whole ? listed : listed.slice(0, TAIL)
    for (const command of kept)
      out.push({
        kind: "command",
        key: commandNodeKey(command),
        command,
        family,
        nested: true,
        depth,
        prefix,
      })
    if (!whole)
      out.push({ kind: "more", key: `m:${family.key}`, family, hidden: listed.length - kept.length, depth })
    return out
  }

  /**
   * Commands' families as folders by their first words: a word two or more families start with is a
   * folder (`mcpx`), a run of single folders is one (`docker compose`), and a family alone at a level
   * is its own row. Families keep their order (what answers first), a folder taking its first one's place.
   */
  const grouped = (
    section: Section,
    entries: readonly { family: Family; listed: readonly Command[]; units: string[] }[],
    depth: number,
    above: string[],
    /** Folders above, for indenting: one folder can cover several words (`docker compose`). */
    level = 0,
  ): Node[] => {
    const out: Node[] = []
    const prefix = above.join(" ")
    type Entry = (typeof entries)[number]
    const buckets = new Map<string, Entry[]>()
    const order: (string | Entry)[] = []
    for (const entry of entries) {
      const unit = entry.units[depth]
      if (entry.units.length <= depth + 1 || unit === undefined) {
        order.push(entry)
        continue
      }
      const bucket = buckets.get(unit)
      if (bucket) bucket.push(entry)
      else {
        buckets.set(unit, [entry])
        order.push(unit)
      }
    }
    for (const item of order) {
      if (typeof item !== "string") {
        out.push(...familyNodes(item.family, item.listed, level, prefix))
        continue
      }
      const bucket = buckets.get(item) as Entry[]
      if (bucket.length === 1) {
        const only = bucket[0] as Entry
        out.push(...familyNodes(only.family, only.listed, level, prefix))
        continue
      }
      const label = [item]
      let next = depth + 1
      while (
        bucket.every((entry) => entry.units.length > next + 1 && entry.units[next] === bucket[0]?.units[next])
      ) {
        label.push(bucket[0]?.units[next] as string)
        next++
      }
      const path = [...above, ...label]
      const key = groupNodeKey(section, path)
      const open = needle !== "" || input.open.has(key)
      out.push({
        kind: "group",
        key,
        label: label.join(" "),
        depth: level,
        prefix: path.join(" "),
        families: bucket.map((entry) => entry.family),
        open,
      })
      if (open) out.push(...grouped(section, bucket, next, path, level + 1))
    }
    return out
  }

  if (needle === "") {
    const suggested = suggestionsOf(input, families)
    if (suggested.length > 0) lines.push({ kind: "heading", section: "suggested" })
    for (const suggestion of suggested) {
      const node: Node = { kind: "suggest", key: `s:${suggestion.key}`, suggestion }
      nodes.push(node)
      lines.push({ kind: "node", node })
    }
  }

  for (const section of SECTIONS) {
    const mine: Node[] = []
    const once: Family[] = []
    const kept: { family: Family; listed: readonly Command[]; units: string[] }[] = []
    /** Old widenings stand on their own, after the rest: no folder holds a family nothing falls in. */
    const old: Family[] = []
    for (const family of families) {
      if (sectionOf(family.permission) !== section) continue
      const named = needle !== "" && familyText(family).toLowerCase().includes(needle)
      const listed =
        needle === "" || named
          ? family.commands
          : family.commands.filter((command) => commandText(command).toLowerCase().includes(needle))
      if (needle !== "" && listed.length === 0 && !named) continue
      if (needle === "" && seenOnce(family)) once.push(family)
      else if (stale(family)) old.push(family)
      else kept.push({ family, listed, units: unitsOf(family) })
    }
    if (section === "commands") mine.push(...grouped(section, kept, 0, []))
    else for (const entry of kept) mine.push(...familyNodes(entry.family, entry.listed))
    for (const family of old) mine.push(...familyNodes(family, family.commands))
    if (once.length === 1) mine.push(...familyNodes(once[0] as Family, (once[0] as Family).commands))
    else if (once.length > 1) {
      const key = onceNodeKey(section)
      const open = input.open.has(key)
      mine.push({ kind: "once", key, section, families: once, open })
      if (open) for (const family of once) mine.push(...familyNodes(family, family.commands))
    }
    if (mine.length === 0) continue
    if (lines.length > 0) lines.push({ kind: "gap" })
    lines.push({ kind: "heading", section })
    for (const node of mine) {
      nodes.push(node)
      lines.push({ kind: "node", node })
    }
  }

  const groups = alwaysGroups(input.state)
  if (
    groups.length > 0 &&
    (needle === "" ||
      "opencode always".includes(needle) ||
      groups.some((group) => group.patterns.join(" ").toLowerCase().includes(needle)))
  ) {
    const node: Node = { kind: "always", key: ALWAYS_KEY, groups }
    if (lines.length > 0) lines.push({ kind: "gap" })
    nodes.push(node)
    lines.push({ kind: "node", node })
  }
  return { nodes, lines, families, commands, counts: countsOf(commands) }
}

/** What `x`, `w` and `c` act on, for a node. Today's strip, a folder and a `seen once` row act on nothing. */
export function nodeTarget(node: Node): Target | undefined {
  if (node.kind === "today" || node.kind === "once" || node.kind === "group") return undefined
  if (node.kind === "always") return { kind: "always", groups: node.groups }
  if (node.kind === "suggest") return { kind: "family", family: node.suggestion.family, suggested: true }
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
    if (seenOnce(family)) tree.open.add(onceNodeKey(sectionOf(family.permission)))
    /** Every folder it could sit in, open: the keys of each run of its first words. */
    const units = unitsOf(family)
    for (let end = 1; end < units.length; end++)
      tree.open.add(groupNodeKey(sectionOf(family.permission), units.slice(0, end)))
    if (!single(family)) {
      tree.open.add(family.key)
      if (at >= TAIL && family.commands.length > TAIL + 1) tree.full.add(family.key)
    }
    return commandNodeKey(family.commands[at] as Command)
  }
  return undefined
}

/** `1 ✓  2 ▰  3 ○`: what a family, or a fold of families, holds — only what it has. */
function tallyRuns(commands: readonly Command[]): Run[] {
  const parts: Run[] = []
  const add = (count: number, mark: string, tone: Tone) => {
    if (count === 0) return
    if (parts.length > 0) parts.push({ text: "  " })
    parts.push({ text: `${count} ${mark}`, tone })
  }
  add(commands.filter((command) => command.phase === "answering").length, "✓", "success")
  add(commands.filter((command) => command.phase === "learning").length, "▰", "warning")
  add(commands.filter((command) => command.phase === "once").length, "○", "muted")
  return parts
}

/** The right-hand column of a tree row: how the command stands, or what a family holds. */
function statusRuns(node: Node): Run[] {
  if (node.kind === "more" || node.kind === "today") return []
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
  if (node.kind === "suggest")
    return [{ text: `${node.suggestion.approvals} in ${node.suggestion.commands}`, tone: "warning" }]
  if (node.kind === "once") return tallyRuns(node.families.flatMap((family) => family.commands))
  if (node.kind === "group") return tallyRuns(node.families.flatMap((family) => family.commands))
  if (node.kind === "family") return tallyRuns(node.family.commands)
  const { command } = node
  const { stand } = leadOf(command)
  if (stand.kind === "trusted") return [{ text: "✓ trusted", tone: "success" }]
  if (stand.kind === "widened") return [{ text: stand.learned ? "✓ read" : "✓ any", tone: "success" }]
  if (stand.expired) return [muted("expired")]
  if (command.phase === "once") return [muted("○ once")]
  return [
    ...meter(stand.have, stand.need, command.danger !== undefined),
    muted(` ${stand.have}/${stand.need}`),
  ]
}

/**
 * One row of the tree. `statusWidth` is the status column's, `badges` the cells before it kept for a
 * dangerous command's `!` — so every meter and every `✓` starts in the same column.
 */
export function treeRow(
  node: Node,
  width: number,
  statusWidth: number,
  badges: number,
  selected: boolean,
): Row {
  const room = Math.max(4, width - statusWidth - badges - 2)
  let left: Run[]
  const indent = "  ".repeat("depth" in node ? node.depth : 0)
  if (node.kind === "family") {
    const files =
      node.family.permission === "edit" ? [muted(`  ${plural(node.family.commands.length, "file")}`)] : []
    const any = stale(node.family)
      ? [{ text: " " }, badge("old", "warning")]
      : node.family.widened.length > 0
        ? [
            { text: " " },
            badge(node.family.widened.every((each) => each.learned) ? "reads" : "any", "success"),
          ]
        : []
    const risk = familyRisk(node.family)
    const marks = [...any, ...(risk ? [{ text: " " }, badge(risk, "error")] : [])]
    const name = squeeze(
      label(rowFamilyText(node.family), node.prefix),
      room - 3 - indent.length - widthOf(rowText([...files, ...marks])),
    )
    left = [
      muted(` ${indent}${node.open ? "▾" : "▸"} `),
      { text: name, tone: seenOnce(node.family) ? "muted" : "text", bold: true },
      ...marks,
      ...files,
    ]
  } else if (node.kind === "group") {
    /** Danger under a folder shows on the folder, so a closed `mcpx` or `git` still says it. */
    const risk = folderRisk(node.families)
    const marks = risk ? [{ text: " " }, badge(risk, "error")] : []
    left = [
      muted(` ${indent}${node.open ? "▾" : "▸"} `),
      {
        text: squeeze(node.label, room - 3 - indent.length - widthOf(rowText(marks))),
        tone: "text",
        bold: true,
      },
      ...marks,
    ]
  } else if (node.kind === "once") {
    const names = node.families.map((family) => rowFamilyText(family)).join("  ")
    left = [
      muted(` ${node.open ? "▾" : "▸"} `),
      plain("seen once"),
      ...(node.open ? [] : [muted(`  ${squeeze(names, Math.max(1, room - 14))}`)]),
    ]
  } else if (node.kind === "command") {
    const lead = (node.nested ? 5 : 3) + indent.length
    left = [
      { text: " ".repeat(lead) },
      {
        text: squeeze(nestedText(node, room - lead), room - lead),
        tone: node.command.phase === "once" ? "muted" : "text",
      },
    ]
  } else if (node.kind === "more") left = [muted(`     ${indent}+ ${node.hidden} more`)]
  else if (node.kind === "always") left = [{ text: " ! ", tone: "warning" }, plain("OpenCode always")]
  else if (node.kind === "suggest") {
    left = [
      { text: " ★ ", tone: "warning" },
      plain(squeeze(`any ${rowFamilyText(node.suggestion.family)}`, Math.max(4, room - 4))),
      muted("?"),
    ]
  } else left = []
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
  const text = label(rowCommandText(node.command), node.prefix)
  if (widthOf(text) <= room || !node.nested) return text
  const family = label(rowFamilyText(node.family), node.prefix)
  if (node.family.permission === "edit" && text.startsWith(family)) return text.slice(family.length)
  return text.startsWith(`${family} `) ? `…${text.slice(family.length)}` : text
}

/** `text` without the words the folders above it already say: `execute_sql` under `mcpx db-local`. */
const label = (text: string, prefix: string) =>
  prefix !== "" && text.startsWith(`${prefix} `) ? text.slice(prefix.length + 1) : text

/**
 * A family's first words, as folders read them: each word as shown, a flag with its value as one
 * (`-p dev`), env vars first, and a place as `(in web)`. Only commands are foldered.
 */
export function unitsOf(family: Family): string[] {
  if (family.permission !== "bash") return [family.family]
  const read = readSubject(family.family)
  if (!read) return [family.family]
  const words = [...read.command.env, ...read.command.argv].map(shown)
  const units: string[] = read.place === undefined ? [] : [`(in ${shown(read.place)})`]
  for (let i = 0; i < words.length; i++) {
    const word = words[i] as string
    const next = words[i + 1]
    if (word.startsWith("-") && !word.includes("=") && next !== undefined && !next.startsWith("-")) {
      units.push(`${word} ${next}`)
      i++
    } else units.push(word)
  }
  return units
}

export const groupNodeKey = (section: Section, words: readonly string[]): string =>
  `g:${section}:${words.join(" ")}`

/** Why a family can never be widened, as its badge: `prod`, or `!` for any other danger. */
function familyRisk(family: Family): string | undefined {
  if (family.permission !== "bash") return undefined
  const read = readSubject(family.family)
  const danger = read ? dangerOf(read.command) : undefined
  return danger === undefined ? undefined : danger === "production" ? "prod" : "!"
}

/** The worst under a folder: `prod` before `!`, from a family or a command still learning. */
function folderRisk(families: readonly Family[]): string | undefined {
  const risks = families.flatMap((family) => [
    familyRisk(family),
    ...family.commands
      .filter((command) => command.danger !== undefined && command.phase !== "answering")
      .map((command) => (command.danger === "production" ? "prod" : "!")),
  ])
  return risks.includes("prod") ? "prod" : risks.includes("!") ? "!" : undefined
}

export const statusWidthOf = (nodes: readonly Node[], width: number) =>
  Math.min(Math.floor(width * 0.45), Math.max(0, ...nodes.map((node) => widthOf(rowText(statusRuns(node))))))

/** Cells for the `!` of a dangerous command among `nodes`: its badge and a space, or none. */
export const badgesOf = (nodes: readonly Node[]) =>
  nodes.some(
    (node) =>
      node.kind === "command" && node.command.danger !== undefined && node.command.phase !== "answering",
  )
    ? 4
    : 0
