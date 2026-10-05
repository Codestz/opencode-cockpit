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
 *
 * The tree is `tree.ts`, the card `card.ts`; this file lays the screen out from both.
 */

import { closeHint, type Hint } from "@opencode-cockpit/client/design"
import type { History } from "../history.ts"
import {
  type Button,
  buttonsAt,
  type CardParts,
  type CardReading,
  cardOf,
  cardRows,
  factLines,
  LABEL,
} from "./card.ts"
import type { Reading } from "./model.ts"
import {
  buttonHits,
  footerRow,
  type Hit,
  headerRow,
  type KeyLine,
  keyListBody,
  muted,
  wrapRuns,
} from "./parts.ts"
import { fit, type Row, type Run, spread, type Tone } from "./rows.ts"
import {
  badgesOf,
  type ExplorerModel,
  explorerModel,
  type Node,
  statusWidthOf,
  type Tree,
  treeRow,
} from "./tree.ts"

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
