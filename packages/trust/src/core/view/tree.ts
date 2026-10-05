/**
 * The ledger's tree: what Trust holds, by what was asked — commands, edits, tools and fetches — then
 * by family, a command one row in its family whatever its agents say.
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

import { showSubject } from "../family.ts"
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
} from "./model.ts"
import { badge, meter, muted, plain, plural } from "./parts.ts"
import { cursorRow, fit, type Row, type Run, rowText, spread, squeeze, type Tone, widthOf } from "./rows.ts"

/** The kinds a ledger is grouped by, in the order they are listed. */
export type Section = "commands" | "edits" | "tools"
export const SECTIONS: readonly Section[] = ["commands", "edits", "tools"]
export const SECTION_TITLES: Record<Section, string> = {
  commands: "COMMANDS",
  edits: "EDITS",
  tools: "TOOLS & FETCHES",
}
export const sectionOf = (permission: string): Section =>
  permission === "bash" ? "commands" : permission === "edit" ? "edits" : "tools"

export type Node =
  /** Today's answers, the strip above the tree: selected, the card lists them. */
  | { kind: "today"; key: string; answers: number }
  | { kind: "family"; key: string; family: Family; open: boolean }
  | { kind: "command"; key: string; command: Command; family: Family; nested: boolean }
  /** The folded tail of an open family: `+ 3 more`. */
  | { kind: "more"; key: string; family: Family; hidden: number }
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
export const familyText = (family: Family) =>
  `${family.permission === "bash" ? "" : `${family.permission} `}${showSubject(family.permission, family.family)}`

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
  const familyNodes = (family: Family, listed: readonly Command[]): Node[] => {
    if (single(family)) {
      const command = family.commands[0] as Command
      return [{ kind: "command", key: commandNodeKey(command), command, family, nested: false }]
    }
    const open = needle !== "" || input.open.has(family.key)
    const out: Node[] = [{ kind: "family", key: familyNodeKey(family), family, open }]
    if (!open) return out
    const whole = needle !== "" || input.full.has(family.key) || listed.length <= TAIL + 1
    const shown = whole ? listed : listed.slice(0, TAIL)
    for (const command of shown)
      out.push({ kind: "command", key: commandNodeKey(command), command, family, nested: true })
    if (!whole)
      out.push({ kind: "more", key: `m:${family.key}`, family, hidden: listed.length - shown.length })
    return out
  }

  for (const section of SECTIONS) {
    const mine: Node[] = []
    const once: Family[] = []
    for (const family of families) {
      if (sectionOf(family.permission) !== section) continue
      const named = needle !== "" && familyText(family).toLowerCase().includes(needle)
      const listed =
        needle === "" || named
          ? family.commands
          : family.commands.filter((command) => commandText(command).toLowerCase().includes(needle))
      if (needle !== "" && listed.length === 0 && !named) continue
      if (needle === "" && seenOnce(family)) once.push(family)
      else mine.push(...familyNodes(family, listed))
    }
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

/** What `x`, `w` and `c` act on, for a node. Today's strip and a `seen once` row act on nothing. */
export function nodeTarget(node: Node): Target | undefined {
  if (node.kind === "today" || node.kind === "once") return undefined
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
    if (seenOnce(family)) tree.open.add(onceNodeKey(sectionOf(family.permission)))
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
  if (node.kind === "once") return tallyRuns(node.families.flatMap((family) => family.commands))
  if (node.kind === "family") return tallyRuns(node.family.commands)
  const { command } = node
  const { stand } = leadOf(command)
  if (stand.kind === "trusted") return [{ text: "✓ trusted", tone: "success" }]
  if (stand.kind === "widened") return [{ text: "✓ any", tone: "success" }]
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
  if (node.kind === "family") {
    const files =
      node.family.permission === "edit" ? [muted(`  ${plural(node.family.commands.length, "file")}`)] : []
    const any = node.family.widened.length > 0 ? [{ text: " " }, badge("any", "success")] : []
    const name = squeeze(rowFamilyText(node.family), room - 3 - widthOf(rowText([...files, ...any])))
    left = [
      muted(` ${node.open ? "▾" : "▸"} `),
      { text: name, tone: seenOnce(node.family) ? "muted" : "text", bold: true },
      ...any,
      ...files,
    ]
  } else if (node.kind === "once") {
    const names = node.families.map((family) => rowFamilyText(family)).join("  ")
    left = [
      muted(` ${node.open ? "▾" : "▸"} `),
      plain("seen once"),
      ...(node.open ? [] : [muted(`  ${squeeze(names, Math.max(1, room - 14))}`)]),
    ]
  } else if (node.kind === "command") {
    const indent = node.nested ? 5 : 3
    left = [
      { text: " ".repeat(indent) },
      {
        text: squeeze(nestedText(node, room - indent), room - indent),
        tone: node.command.phase === "once" ? "muted" : "text",
      },
    ]
  } else if (node.kind === "more") left = [muted(`     + ${node.hidden} more`)]
  else if (node.kind === "always") left = [{ text: " ! ", tone: "warning" }, plain("OpenCode always")]
  else left = []
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
  const text = rowCommandText(node.command)
  if (widthOf(text) <= room || !node.nested) return text
  const family = rowFamilyText(node.family)
  if (node.family.permission === "edit" && text.startsWith(family)) return text.slice(family.length)
  return text.startsWith(`${family} `) ? `…${text.slice(family.length)}` : text
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
