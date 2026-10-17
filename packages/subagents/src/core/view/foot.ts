/**
 * The foot of the pane, pinned under the run so nothing scrolls it away: a permission the subagent
 * is held on, as a card you answer from here, and the box you message it from — OpenCode's own
 * prompt, in the pane.
 *
 *    ▎ △ Permission required · bash                                       1 of 2
 *    ▎ $ npm test -- login
 *    ▎ [y] Allow once   [Y] Allow always   [n] Reject
 *
 *    ┃ Message explore…                                     tab or click to type
 *    ┃
 *    ┃ Explore · space-bunny-free opencode
 *
 * Before the card, a subagent that asked while you watched it had to be closed to be answered: the
 * only prompt was OpenCode's, under the pane. Pure, like everything in `core/`. Each row comes with
 * the parts of it a click acts on (`Hit`): a click on `Allow once` answers as `y` does, and one on
 * the box starts typing as `tab` does.
 */

import { HINT_GAP, type Hint, hintRuns } from "@opencode-cockpit/client/design"
import type { Permission, Session } from "../model/model.ts"
import { PAD } from "./calls.ts"
import { fit, type Row, type Run, spread, widthOf, wrap } from "./rows.ts"

/** What a click on part of the foot does. */
export type Act = "focus" | "once" | "always" | "reject"

/** The columns of a row a click acts on, `from` up to but not including `to`. */
export interface Hit {
  act: Act
  from: number
  to: number
}

export interface FootRow {
  row: Row
  hits?: Hit[]
}

/** The message box: what is typed so far, where the cursor is in it, and whether keys go into it. */
export interface Prompt {
  draft: string
  /** The cursor, as an index into `draft`; its end when unset. */
  caret?: number
  focused: boolean
  /** It is working: what you send is picked up in its current run. */
  busy: boolean
}

/**
 * The keys the card answers with, and what each sends. Not `enter`: it opens the item under the
 * cursor, and one press too many would have approved a command. Not `a`: it already shows a call's
 * whole output. `y` and `n` are free in the pane and say yes and no; `Y` is the bigger yes.
 */
export const PERMISSION_KEYS: readonly (Hint & { act: Exclude<Act, "focus"> })[] = [
  { key: "y", label: "Allow once", act: "once" },
  { key: "Y", label: "Allow always", act: "always" },
  { key: "n", label: "Reject", act: "reject" },
]

/** Lines of a command the card shows before it cuts the rest: enough to read what will run. */
export const COMMAND_LINES = 4

/**
 * What the request would run or touch: the call's whole command line when the run has it — the
 * request's own patterns are split per command (`cd x && make` asks twice) — else those patterns.
 */
export function askedFor(session: Session, ask: Permission): string {
  const call = ask.call
    ? session.entries.find((entry) => entry.kind === "tool" && entry.call === ask.call)
    : undefined
  const command = call?.kind === "tool" ? call.input.command : undefined
  if (typeof command === "string" && command.trim()) return `$ ${command.trim()}`
  return ask.patterns.join("  ")
}

/**
 * The card for the first of `pending`, in the warning tone OpenCode's own prompt wears. `error` is
 * what the host said when the last answer to it failed: it stays until an answer goes through.
 */
export function permissionRows(
  session: Session,
  pending: readonly Permission[],
  width: number,
  options: { lines?: number; error?: string } = {},
): FootRow[] {
  const ask = pending[0]
  if (!ask) return []
  const fill = "card" as const
  const bar: Run = { text: `${PAD}▎ `, tone: "warning", fill }
  const rows: FootRow[] = [
    {
      row: spread(
        [
          bar,
          { text: "△ Permission required", tone: "warning", bold: true, fill },
          { text: ` · ${ask.permission}`, tone: "muted", fill },
        ],
        pending.length > 1 ? [{ text: `1 of ${pending.length} `, tone: "muted", fill }] : [],
        width,
      ),
    },
  ]
  const most = Math.max(1, options.lines ?? COMMAND_LINES)
  const text = askedFor(session, ask)
  const lines = text ? wrap(text, width - PAD.length - 3) : []
  lines.slice(0, most).forEach((line, at) => {
    const last = at === most - 1 && lines.length > most
    rows.push({ row: fit([bar, { text: last ? `${line}…` : line, tone: "text", fill }], width) })
  })
  if (options.error)
    rows.push({ row: fit([bar, { text: `Not answered: ${options.error}`, tone: "error", fill }], width) })
  /** The keys, each one a place to click: its columns are counted as the row is laid out. */
  const runs: Run[] = [bar]
  const hits: Hit[] = []
  let used = widthOf(bar.text)
  PERMISSION_KEYS.forEach((hint, at) => {
    if (at > 0) {
      runs.push({ text: " ".repeat(HINT_GAP), fill })
      used += HINT_GAP
    }
    const parts = hintRuns(hint).map((run): Run => ({ ...run, fill }))
    const size = parts.reduce((sum, run) => sum + widthOf(run.text), 0)
    runs.push(...parts)
    if (used < width) hits.push({ act: hint.act, from: used, to: Math.min(width, used + size) })
    used += size
  })
  rows.push({ row: fit(runs, width), hits })
  return rows
}

/** `explore` as OpenCode's prompt names an agent under its box: `Explore`. */
const named = (agent: string) => agent.charAt(0).toUpperCase() + agent.slice(1)

/**
 * The message box, as OpenCode draws its own: an accent edge, the line you type on, and under it
 * the agent, its model and whose model that is. Unfocused it says how to start; focused, the cursor
 * is where you type. One line wide: a draft longer than the box shows the part around the cursor.
 */
export function promptRows(
  session: Session,
  prompt: Prompt,
  width: number,
  options: { spacer?: boolean; meta?: boolean } = {},
): FootRow[] {
  const fill = "block" as const
  const bar: Run = { text: `${PAD}┃ `, tone: "accent", fill }
  const whole: Hit[] = [{ act: "focus", from: 0, to: width }]
  const placeholder = `Message ${session.agent}…`
  const room = Math.max(4, width - widthOf(bar.text) - 1)
  let line: Row
  if (prompt.focused) {
    const caret = Math.max(0, Math.min(prompt.draft.length, prompt.caret ?? prompt.draft.length))
    /** The part of a long draft around the cursor, marked `…` where it was cut. */
    const start = Math.max(0, caret - (room - 2))
    const before = (start > 0 ? "…" : "") + prompt.draft.slice(start, caret)
    const after = prompt.draft.slice(caret)
    line = fit(
      [
        bar,
        { text: before, tone: "text", fill },
        { text: "▍", tone: "accent", fill },
        prompt.draft === ""
          ? { text: placeholder, tone: "muted", fill }
          : { text: after, tone: "text", fill },
      ],
      width,
    )
  } else {
    line = spread(
      [
        bar,
        prompt.draft
          ? { text: prompt.draft, tone: "text", fill }
          : { text: placeholder, tone: "muted", fill },
      ],
      [{ text: `${prompt.draft ? "tab to keep typing" : "tab or click to type"} `, tone: "muted", fill }],
      width,
    )
  }
  const rows: FootRow[] = [{ row: line, hits: whole }]
  if (options.spacer !== false) rows.push({ row: fit([bar], width), hits: whole })
  if (options.meta !== false) {
    /** The variant OpenCode runs everything at by default is not news; one you chose is. */
    const variant = session.variant && session.variant !== "default" ? session.variant : undefined
    rows.push({
      row: fit(
        [
          bar,
          { text: named(session.agent), tone: "accent", bold: true, fill },
          ...(session.model ? [{ text: ` · ${session.model}`, tone: "text" as const, fill }] : []),
          ...(session.provider ? [{ text: ` ${session.provider}`, tone: "muted" as const, fill }] : []),
          ...(variant ? [{ text: ` · ${variant}`, tone: "muted" as const, fill }] : []),
        ],
        width,
      ),
      hits: whole,
    })
  }
  return rows
}
