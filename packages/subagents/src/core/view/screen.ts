/**
 * One subagent, in the pane: its run as a timeline you can move through and open.
 *
 *    ⠙ EXPLORE  Scan architecture opportunities                          running 3m32s
 *     space-bunny-free · background · launched by build · 108 calls · 14 steps · 2.2M tok
 *     ‹ 2/3 ›  general Review diff   explore Scan arch…   general Verify
 *
 *     ▎ Task from build
 *     ▎ Inspect the codebase architecture and docs; identify one or two…
 *
 *     ◇ Thinking  Need inspect sizes to identify. Glob source…
 *     › read   docs/building/a-new-bay.md
 *     ⌄ grep   "loadConfig" *.ts                                   9 matches · 1.4s
 *       │ pattern  loadConfig
 *       │ include  *.ts
 *       │ ─
 *       │ packages/shell/src/core/config.ts:80: export function loadConfig(
 *
 *     ## Findings …                                   (the answer, as markdown)
 *
 * Every item — a call, a block of thinking, a message you sent — is selectable (`j`/`k`) and opens
 * or folds (`enter`, a click). Every row is exactly `width`; there are exactly `height` rows; only
 * the body scrolls. Pure, like everything in `core/`.
 *
 * Each item's lines — a call's row or box, a todo list, a card, the thinking — come from `calls.ts`.
 */

import {
  closeHint,
  fitHints,
  type Hint,
  hintRuns,
  keyName,
  stateMark,
  toneOf,
} from "@opencode-cockpit/client/design"
import { callsOf, type Entry, type Node, type Session, titleOf } from "../model/model.ts"
import {
  boxed,
  cardLines,
  childOf,
  drawingOf,
  itemKey,
  type Line,
  PAD,
  running,
  type Tool,
  thinkingLines,
  toolLines,
  trimEnd,
} from "./calls.ts"
import { markdownRows } from "./markdown.ts"
import { compact, cut, fit, type Row, type Run, rowText, spread, widthOf, wrap } from "./rows.ts"
import { firstStarted, runPhrase, stateOf } from "./sidebar.ts"

export interface ScreenInput {
  session: Session
  /** Every subagent of the conversation, for "2/3" and the switcher. */
  nodes: readonly Node[]
  /** The agent that launched it: "Task from build". */
  launcher?: string
  width: number
  height: number
  now: number
  frame: number
  /** First body row shown; undefined follows the run as it grows. */
  top?: number
  /** The item under the cursor. */
  selected?: string
  /** Whether a message to the subagent was yours — the rest came from the main agent continuing it. */
  yours?: (entry: Extract<Entry, { kind: "prompt" }>) => boolean
  /** Calls whose output is shown whole rather than its first lines (`a`). */
  whole?: ReadonlySet<string>
  /** The cursor just moved: bring the selected item into view. Scrolling does not. */
  reveal?: boolean
  /** Items opened by hand; running calls are open unless folded by hand (`closed`). */
  open: ReadonlySet<string>
  closed: ReadonlySet<string>
  /** Every thinking block open, not just the ones opened by hand. */
  thinking: boolean
  /** The details view in place of the timeline. */
  details: boolean
  /** `?`: every key the pane takes, in the body's place. */
  keys?: boolean
  /** A message being typed at the bottom of the pane. */
  input?: { draft: string; busy: boolean }
  /** A line under the keys: what just happened. */
  notice?: string
  /** What each item drew last time, kept by the caller between paints (`createScreenCache`). */
  cache?: ScreenCache
  /**
   * The MCP servers OpenCode has, so `context7_query-docs` can be titled `context7 · query-docs`.
   * Without them a tool keeps its own name: the name alone cannot say where a server's ends.
   */
  servers?: readonly string[]
}

/**
 * Each item's rows from the paint before, and what they were drawn from. A paint redraws only the
 * items that changed — a scroll, a spinner tick or a new call no longer lays out every call, every
 * block of thinking and the whole answer again (32 ms a paint on a 200-call run, measured).
 */
export interface ScreenCache {
  items: Map<string, { sig: string; lines: Line[] }>
}

export const createScreenCache = (): ScreenCache => ({ items: new Map() })

export interface Screen {
  rows: Row[]
  /** The item each row belongs to, for a click. */
  items: (string | undefined)[]
  /** Selectable items, in order, for `j`/`k`. */
  keys: string[]
  /** Items drawn open, so a toggle knows which way to go. */
  opened: string[]
  /** The first body row shown, resolved. */
  top: number
  /** The furthest the body can scroll. */
  most: number
  /** Where the body starts on screen, for mapping a click. */
  bodyAt: number
  /** A `task` call's item, and the subagent it launched: `enter` on it goes there. */
  links: Map<string, string>
}

/**
 * How much a call's arguments hold, for the paint cache: a call's input can arrive, or grow, after
 * the call is first drawn. Strings by length — a long question is not hashed on every paint.
 */
function sizeOf(input: Record<string, unknown>): number {
  let size = 0
  for (const [name, value] of Object.entries(input))
    size += name.length + (typeof value === "string" ? value.length : (JSON.stringify(value)?.length ?? 0))
  return size
}

function bodyLines(input: ScreenInput, width: number, opened: string[], links: Map<string, string>): Line[] {
  const { session, now, frame } = input
  const lines: Line[] = []
  const blank = () => {
    if (lines.length > 0 && !lines.at(-1)?.row.every((run) => run.text.trim() === ""))
      lines.push({ row: fit([], width) })
  }
  lines.push(
    ...cardLines(
      `Task from ${input.launcher ?? "the main agent"}`,
      session.task ?? session.title ?? "",
      width,
      "accent",
      "card",
    ),
  )

  /**
   * Room between items, as OpenCode leaves it: a blank line between any two — except a run of calls,
   * which reads as one list, unless one of them is open.
   */
  let last: { kind: Entry["kind"]; open: boolean } | undefined
  let round = 1
  const seen = new Set<string>()
  /** An item's rows from the cache when what they are drawn from has not changed. */
  const drawn = (key: string, sig: string, draw: () => Line[]): Line[] => {
    seen.add(key)
    const hit = input.cache?.items.get(key)
    if (hit && hit.sig === sig) return hit.lines
    const lines = draw()
    input.cache?.items.set(key, { sig, lines })
    return lines
  }
  session.entries.forEach((entry, index) => {
    if (entry.kind === "prompt" && entry.first) return
    const key = itemKey(entry)
    switch (entry.kind) {
      case "prompt": {
        /**
         * Another round: the main agent continued this subagent, or you wrote to it. A rule says where
         * the round starts; the card says who started it.
         */
        round += 1
        const mine = input.yours?.(entry) ?? false
        const from = mine ? "You" : `${input.launcher ?? "The main agent"} continued it`
        blank()
        lines.push(
          ...drawn(key, `${width}|${entry.text.length}|${mine}|${round}|${input.launcher}`, () => [
            {
              row: fit(
                [
                  { text: `${PAD}── Round ${round} `, tone: "muted" },
                  { text: "─".repeat(width), tone: "border" },
                ],
                width,
              ),
            },
            { row: fit([], width) },
            ...cardLines(from, entry.text, width, mine ? "info" : "accent", "card", key),
          ]),
        )
        last = { kind: "prompt", open: false }
        return
      }
      case "thinking": {
        blank()
        const isOpen = (input.thinking || input.open.has(key)) && !input.closed.has(key)
        if (isOpen) opened.push(key)
        const next = session.entries[index + 1]
        const took = entry.done && next ? next.at - entry.at : undefined
        lines.push(
          ...drawn(key, `${width}|${isOpen}|${entry.text.length}|${entry.done}|${took}`, () =>
            thinkingLines(entry, width, isOpen, took),
          ),
        )
        last = { kind: "thinking", open: isOpen }
        return
      }
      case "tool": {
        const live = entry.state === "running" || entry.state === "pending"
        const isOpen = input.open.has(key) && !input.closed.has(key)
        const child =
          entry.name === "task" || entry.name === "subagent"
            ? childOf(entry, session, input.nodes)
            : undefined
        if (child) links.set(key, child.id)
        const drawing = drawingOf(entry, input.servers, child)
        /** A checklist is several rows, so it gets the room around it a box does. */
        const box = boxed(entry, drawing, isOpen, width) || drawing.renderer.kind === "todos"
        if (last?.kind !== "tool" || last.open || box) blank()
        if (isOpen) opened.push(key)
        /** A running call's spinner and clock change every tick; a finished one never again. */
        const clock = live ? `|${frame}|${Math.floor((now - entry.at) / 1000)}` : ""
        const sig = `${width}|${isOpen}|${entry.state}|${entry.output.length}|${entry.error?.length}|${entry.summary}|${entry.ended}|${sizeOf(entry.input)}|${drawing.renderer.title}|${drawing.target}${clock}`
        const whole = isOpen && Boolean(input.whole?.has(key))
        lines.push(
          ...drawn(key, `${sig}|${whole}`, () => toolLines(entry, drawing, width, now, frame, isOpen, whole)),
        )
        last = { kind: "tool", open: box }
        return
      }
      case "reply": {
        blank()
        lines.push(
          ...drawn(key, `${width}|${entry.text.length}|${entry.done}`, () => replyLines(entry, width)),
        )
        last = { kind: "reply", open: false }
        return
      }
    }
  })
  /** Items gone from the run (another subagent opened) leave the cache with it. */
  if (input.cache)
    for (const key of input.cache.items.keys()) if (!seen.has(key)) input.cache.items.delete(key)
  if (session.status === "failed" && session.error) {
    blank()
    for (const line of wrap(`Failed: ${session.error}`, width - PAD.length * 2)) {
      lines.push({ row: fit([{ text: PAD }, { text: line, tone: "error" }], width) })
    }
  }
  return lines
}

/** The answer, drawn as markdown, with a cursor while it is still being written. */
function replyLines(entry: Extract<Entry, { kind: "reply" }>, width: number): Line[] {
  const rows = markdownRows(entry.text || "…", width - PAD.length, { indent: PAD.length })
  /** Still writing: a cursor where the words end, or under them when the line is full. */
  const end = rows.at(-1)
  if (!entry.done && end) {
    const used = widthOf(
      end
        .map((run) => run.text)
        .join("")
        .trimEnd(),
    )
    if (used < width - 1) rows[rows.length - 1] = [...trimEnd(end), { text: "▍", tone: "accent" }]
    else rows.push([{ text: `${PAD}▍`, tone: "accent" }])
  }
  /** Not an item: an answer does not open or fold. */
  return rows.map((row) => ({ row: fit(row, width) }))
}

function detailLines(input: ScreenInput, width: number): Line[] {
  const { session } = input
  const tools = session.entries.filter((entry): entry is Tool => entry.kind === "tool")
  const byName = new Map<string, number>()
  for (const call of tools) byName.set(call.name, (byName.get(call.name) ?? 0) + 1)
  const calls = [...byName.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => `${n} ${name}`)
  const pairs: [string, string][] = [
    [
      "Agent",
      `${session.agent} — launched by ${input.launcher ?? "the main agent"}${session.background ? ", in the background" : ""}`,
    ],
    ["Model", session.model ?? "not reported"],
    ["Denied", session.denied.length > 0 ? session.denied.join(", ") : "nothing denied outright"],
    ["Calls", tools.length > 0 ? `${tools.length}  —  ${calls.join(" · ")}` : "none"],
    ["Steps", session.steps ? `${session.steps}` : "—"],
    ["Tokens", session.tokens ? compact(session.tokens) : "—"],
    ["Cost", `$${session.cost.toFixed(3)}`],
    ["Session", session.id],
  ]
  const lines: Line[] = []
  for (const [label, value] of pairs) {
    const head: Run[] = [{ text: PAD }, { text: label.padEnd(10), tone: "muted" }]
    wrap(value, width - PAD.length - 10).forEach((text, i) => {
      lines.push({
        row: fit(
          [...(i === 0 ? head : [{ text: `${PAD}${" ".repeat(10)}` }]), { text, tone: "text" }],
          width,
        ),
      })
    })
  }
  return lines
}

function header(input: ScreenInput, width: number): Row[] {
  const { session, now, frame, nodes } = input
  /** The mark, tone and word the sidebar gives the same run (client/design). */
  const now_ = stateOf(session)
  const glyph: Run = { ...stateMark(now_, frame), fill: "band" }
  /** In the words the main agent's tools use for the same run (core/view/sidebar.ts). */
  const state = runPhrase(session, now)
  const tools = callsOf(session)
  const meta = [
    /** Its time above is the last round's; the tools say this beside it too. */
    firstStarted(session, now) ?? "",
    session.model ?? "",
    session.background ? "background" : "",
    input.launcher ? `launched by ${input.launcher}` : "",
    `${tools} call${tools === 1 ? "" : "s"}`,
    session.steps ? `${session.steps} step${session.steps === 1 ? "" : "s"}` : "",
    session.tokens ? `${compact(session.tokens)} tok` : "",
  ]
    .filter(Boolean)
    .join(" · ")
  const rows: Row[] = [
    spread(
      [
        /** A space, not `▌`: that glyph is the cursor, and the header is not a selected row. */
        { text: " ", fill: "band" },
        glyph,
        { text: ` ${session.agent.toUpperCase()} `, tone: "info", bold: true, fill: "band" },
        { text: ` ${titleOf(session)}`, tone: "text", bold: true, fill: "band" },
      ],
      [
        {
          text: `${state} `,
          tone: toneOf(now_),
          fill: "band",
        },
      ],
      width,
    ),
    fit([{ text: `${PAD}${meta}`, tone: "muted", fill: "band" }], width),
  ]
  if (nodes.length > 1) {
    const at = nodes.findIndex((node) => node.session.id === session.id)
    const runs: Run[] = [{ text: `${PAD}‹ ${at + 1}/${nodes.length} ›  `, tone: "muted", fill: "band" }]
    const each = Math.max(12, Math.floor((width - 14) / nodes.length) - 3)
    for (const node of nodes) {
      const current = node.session.id === session.id
      const label = cut(`${node.session.agent} ${titleOf(node.session)}`, each)
      runs.push(
        { text: label, tone: current ? "accent" : "muted", bold: current, fill: "band" },
        { text: "   ", fill: "band" },
      )
    }
    rows.push(fit(runs, width))
  }
  return rows
}

function footer(input: ScreenInput, width: number): Row[] {
  const { session } = input
  if (input.input) {
    const hint = input.input.busy
      ? "it picks this up in its current run"
      : "it answers, and the main agent hears it"
    return [
      fit(
        [
          { text: `${PAD}┃ `, tone: "accent", fill: "block" },
          { text: input.input.draft, tone: "text", fill: "block" },
          { text: "▍", tone: "accent", fill: "block" },
        ],
        width,
      ),
      /** The keys in the shape every footer uses; the note gives way to them. */
      spread(
        [{ text: `${PAD}  to ${session.agent} · ${hint}`, tone: "muted" }],
        [
          ...hintRuns({ key: "enter", label: "Send" }),
          { text: "   " },
          ...hintRuns(closeHint("Cancel")),
          { text: " " },
        ],
        width,
      ),
    ]
  }
  /** On the keys screen the only key worth a row is the way back to the run (Review's, Trust's). */
  if (input.keys) {
    const back: Run[] = [{ text: PAD }, ...fitHints([closeHint("Hide Keys")], width - PAD.length).runs]
    return [fit(back, width), fit([], width)]
  }
  /**
   * In the order drawn, each with its rank: at half width the lowest-ranked go first, and the way out
   * never does — it used to be the lowest, so the first key a narrow pane lost was how to leave it.
   * The cutting, the `…` and the shape are the ones every bay shares (client/design). `[?] Keys`
   * gives way late: it is where every key the row dropped can still be found.
   */
  const all: Hint[] = [
    { key: "j/k", label: "Select", priority: 5 },
    { key: "enter", label: "Open", priority: 9 },
    { key: "m", label: "Message", priority: 8 },
    { key: "x", label: running(session) ? "Stop" : "Remove", priority: 7 },
    ...(running(session) && !session.background ? [{ key: "b", label: "Background", priority: 6 }] : []),
    { key: "t", label: input.thinking ? "Hide Thinking" : "Show Thinking", priority: 3 },
    { key: "i", label: input.details ? "Timeline" : "Details", priority: 6 },
    { key: "w", label: "Width", priority: 4 },
    { key: "?", label: "Keys", priority: 8.5 },
    closeHint("Back"),
  ]
  const keys: Run[] = [{ text: PAD }, ...fitHints(all, width - PAD.length).runs]
  const note =
    input.notice ??
    (session.status === "done" ? "Finished — message it; the main agent hears the answer." : "")
  return [fit(keys, width), fit([{ text: `${PAD}${note}`, tone: "muted" }], width)]
}

export interface KeyLine {
  keys: string[]
  does: string
}

/**
 * `[?] Keys`: every key the pane takes, in the order a run is read — move, open, act on the
 * subagent, the view — then the way out. The footer has room for the ones used constantly and says
 * `…` for the rest; this is the rest, the same screen Review and Trust have.
 */
export const SUBAGENT_KEYS: readonly KeyLine[] = [
  { keys: ["j/k", "↑/↓"], does: "Move the cursor through the run: calls, thinking, your messages" },
  {
    keys: ["enter", "space"],
    does: "Open or fold the item under the cursor; on a task call, go into that subagent",
  },
  { keys: ["a"], does: "A call's whole output, or back to its first lines" },
  { keys: ["e"], does: "Open every call, or fold them all" },
  { keys: ["←/→"], does: "Previous or next subagent of this conversation (also [ and ])" },
  { keys: ["m"], does: "Message this subagent; finished, its answer is passed on to the main agent" },
  { keys: ["x"], does: "Stop it (press twice), or once it has ended, take it off the list" },
  { keys: ["X"], does: "Take every finished subagent off the list" },
  { keys: ["b"], does: "Move it to the background: the main agent stops waiting for it" },
  { keys: ["t"], does: "Show or hide thinking" },
  { keys: ["i"], does: "Details: model, tokens, cost, the session id — or back to the timeline" },
  { keys: ["w"], does: "Half the window, or all of it" },
  { keys: ["d", "u"], does: "Scroll down or up (also pgdn, pgup)" },
  { keys: ["g", "G"], does: "The start of the run, or follow it as it grows (also home, end)" },
  { keys: ["?", "esc"], does: "Hide these keys; on the run, esc lets go of the cursor, then closes" },
]

/** The keys in the body's place: each line's keys in a column, what it does wrapped beside them. */
function keyLines(width: number): Line[] {
  const column = Math.max(
    ...SUBAGENT_KEYS.map((line) => widthOf(line.keys.map((name) => `[${keyName(name)}]`).join(" "))),
  )
  const indent = PAD.length + column + 3
  const lines: Line[] = [
    { row: fit([{ text: `${PAD}KEYS`, tone: "text", bold: true }], width) },
    { row: fit([], width) },
  ]
  for (const line of SUBAGENT_KEYS) {
    const keys: Run[] = line.keys.flatMap((name, at): Run[] => [
      ...(at > 0 ? [{ text: " " }] : []),
      { text: `[${keyName(name)}]`, tone: "accent", bold: true },
    ])
    const used = widthOf(rowText(keys))
    wrap(line.does, Math.max(1, width - indent - PAD.length)).forEach((text, at) => {
      lines.push({
        row: fit(
          [
            { text: PAD },
            ...(at === 0
              ? [...keys, { text: " ".repeat(column - used + 3) }]
              : [{ text: " ".repeat(column + 3) }]),
            { text, tone: "muted" },
          ],
          width,
        ),
      })
    })
  }
  return lines
}

/** The selected item's rows, marked: a coloured edge and the selection fill. */
function mark(lines: Line[], selected: string | undefined, width: number): Line[] {
  if (!selected) return lines
  return lines.map((line) => {
    if (line.item !== selected) return line
    const [first, ...rest] = line.row
    const edge: Run = { text: "▌", tone: "accent", fill: "selected" }
    const head: Run = { ...(first as Run), text: (first as Run).text.slice(1), fill: "selected" }
    return {
      ...line,
      row: fit(
        [
          edge,
          head,
          ...rest.map((run) => ({
            ...run,
            fill: run.fill === "none" || !run.fill ? ("selected" as const) : run.fill,
          })),
        ],
        width,
      ),
    }
  })
}

export function screenRows(input: ScreenInput): Screen {
  const width = Math.max(24, input.width)
  const height = Math.max(8, input.height)
  const top = header(input, width)
  const bottom = footer(input, width)
  const room = Math.max(1, height - top.length - bottom.length - 2)
  const opened: string[] = []
  const links = new Map<string, string>()
  const body = input.keys
    ? keyLines(width)
    : input.details
      ? detailLines(input, width)
      : mark(bodyLines(input, width, opened, links), input.selected, width)
  const keys =
    input.details || input.keys
      ? []
      : [...new Set(body.map((line) => line.item).filter((item): item is string => Boolean(item)))]
  const most = Math.max(0, body.length - room)
  /** Following the run means its end; the keys are read from their first line (and scroll as the run does). */
  let first = input.top === undefined ? (input.keys ? 0 : most) : Math.min(Math.max(0, input.top), most)
  /**
   * The cursor moved onto an item: bring it into view. Only then — pinned on every paint, a selected
   * item longer than the pane snapped back to its first line whenever you scrolled into it.
   */
  if (input.reveal && input.selected && input.top !== undefined) {
    const at = body.findIndex((line) => line.item === input.selected)
    if (at >= 0 && at < first) first = at
    if (at >= first + room) first = Math.min(most, at - room + 3)
  }
  const shown = body.slice(first, first + room)
  /** A key list cut short says so, and how to reach the rest, as Review's and Trust's do. */
  const below = body.length - (first + room)
  if (input.keys && below > 0 && shown.length > 1) {
    const left = below + 1
    shown[shown.length - 1] = {
      row: fit(
        [{ text: `${PAD}↓ ${left} more line${left === 1 ? "" : "s"} — [d] scrolls`, tone: "muted" }],
        width,
      ),
    }
  }
  while (shown.length < room) shown.push({ row: fit([], width) })
  const blank = fit([], width)
  return {
    rows: [...top, blank, ...shown.map((line) => line.row), blank, ...bottom],
    items: [
      ...top.map(() => undefined),
      undefined,
      ...shown.map((line) => line.item),
      undefined,
      ...bottom.map(() => undefined),
    ],
    keys,
    opened,
    top: first,
    most,
    bodyAt: top.length + 1,
    links,
  }
}

/** For tests and the preview: the columns a row takes. */
export const rowWidth = (row: Row): number => widthOf(row.map((run) => run.text).join(""))
