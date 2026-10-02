/**
 * The sidebar block: what Trust answered for you in this window, and what it is counting now.
 *
 *   Trust                     4 auto
 *   ● git status                  7×
 *   ● edit src/app.ts             3×
 *   ○ docker compose up          2/3
 *
 * A filled dot is an answer Trust gave, with how many times it has answered that in all; a hollow
 * one is a request on screen now and how far it is from being trusted. Answers are visible every
 * time — that is the bargain that makes answering for you acceptable — but the block says nothing
 * when there is nothing to say: no answers yet, nothing counting, not paused. A failure always speaks.
 *
 * An answer given through a family you widened says so — `● ls -R docs · any ls  1×` — because
 * that rule was never approved by itself, and the answer should not look as if it had been.
 * Commands are shown the way the ledger shows them (`family.showSubject`): `echo "---"`, never a
 * bare `---` a font can merge into a line.
 *
 * Plain geometric marks, not ⚡: the emoji draws two columns wide in most terminals and one in some,
 * which breaks a grid that has to be exact; Subagents' sidebar uses the same dots.
 */

import { HEADING_GAP } from "@opencode-cockpit/client/design"
import type { Answered, Pending } from "../engine.ts"
import { anyOf, showSubject } from "../family.ts"
import { keyOf, type State } from "../ledger.ts"
import { fit, type Row, spread } from "./rows.ts"

export interface SidebarInput {
  width: number
  /** Answers in this window, newest first. */
  recent: readonly Answered[]
  /** How many answers in this window. */
  count: number
  pending: readonly Pending[]
  state: State
  /** Something went wrong and you should know: drawn whatever else is going on. */
  trouble?: string
  /** Answers listed; the count in the heading covers the rest. */
  limit: number
}

/** `edit src/app.ts`, but a command is just the command: bash is the common case. */
export function labelOf(permission: string, label: string): Row {
  return permission === "bash"
    ? [{ text: label, tone: "text" }]
    : [
        { text: `${permission} `, tone: "tool" },
        { text: label, tone: "text" },
      ]
}

/** How often Trust answered this in all: the least of its parts, since a line is answered whole. */
function times(state: State, answered: Answered): number {
  const counts = answered.subjects.map(
    (subject) => state.entries.get(keyOf(answered.permission, answered.agent, subject))?.autos ?? 0,
  )
  return Math.max(1, counts.length > 0 ? Math.min(...counts) : 1)
}

export function sidebarRows(input: SidebarInput): Row[] {
  const { width, state } = input
  if (width < 8) return []
  const rows: Row[] = []

  /** Requests on screen that Trust has started counting; a first sighting at 0 is not news. */
  const counting = input.pending.flatMap((pending) => {
    const short = pending.judgement.progress.filter((p) => !p.trusted)
    if (short.length === 0 || pending.judgement.answer) return []
    const worst = short.reduce((a, b) => (b.need - b.have > a.need - a.have ? b : a))
    return worst.have > 0 ? [{ permission: pending.request.permission, worst }] : []
  })

  const listed: Answered[] = []
  for (const answered of input.recent) {
    if (listed.length >= input.limit) break
    if (listed.some((each) => each.label === answered.label && each.permission === answered.permission))
      continue
    listed.push(answered)
  }

  const quiet = input.count === 0 && counting.length === 0 && !state.paused && !input.trouble
  if (quiet) return []

  rows.push(
    spread(
      [{ text: "Trust", tone: "text", bold: true }],
      state.paused
        ? [{ text: "paused", tone: "warning" }]
        : input.count > 0
          ? [{ text: `${input.count} auto`, tone: "success" }]
          : [],
      width,
    ),
  )
  /** The same row of air under the heading every block has (client/design). */
  for (let gap = 0; gap < HEADING_GAP; gap++) rows.push(spread([], [], width))
  for (const answered of listed)
    rows.push(
      spread(
        [
          { text: "● ", tone: "success" },
          ...labelOf(
            answered.permission,
            answered.subjects.map((subject) => showSubject(answered.permission, subject)).join(" && "),
          ),
          ...(answered.via !== undefined
            ? [
                {
                  text: ` · ${anyOf(answered.permission, answered.via).replace(/ …$/, "")}`,
                  tone: "muted" as const,
                },
              ]
            : []),
        ],
        [{ text: `${times(state, answered)}×`, tone: "muted" }],
        width,
      ),
    )
  for (const { permission, worst } of counting)
    rows.push(
      spread(
        [{ text: "○ ", tone: "warning" }, ...labelOf(permission, showSubject(permission, worst.subject))],
        [{ text: `${worst.have}/${worst.need}`, tone: worst.danger ? "error" : "warning" }],
        width,
      ),
    )
  if (input.trouble) rows.push(fit([{ text: `⚠ ${input.trouble}`, tone: "error" }], width))
  return rows
}
