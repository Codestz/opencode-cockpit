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
import { cursorRow, fit, type Row, type Run, rowText, spread, type Tone, widthOf } from "./rows.ts"

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

export const commandText = (command: Command) =>
  `${command.permission === "bash" ? "" : `${command.permission} `}${showSubject(command.permission, command.subject)}`
export const familyText = (family: Family) =>
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
export function treeRow(
  node: Node,
  width: number,
  statusWidth: number,
  badges: number,
  selected: boolean,
): Row {
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
