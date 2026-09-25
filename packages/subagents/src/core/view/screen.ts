/**
 * One subagent, in the pane: its run as a timeline you can move through and open.
 *
 *   ▌⠙ EXPLORE  Scan architecture opportunities                          running 3m32s
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
 */

import { type Entry, type Node, type Session, toolTarget } from "../model/model.ts"
import { markdownRows } from "./markdown.ts"
import { compact, cut, elapsed, fit, type Row, type Run, spin, spread, widthOf, wrap } from "./rows.ts"

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
  /** Items opened by hand; running calls are open unless folded by hand (`closed`). */
  open: ReadonlySet<string>
  closed: ReadonlySet<string>
  /** Every thinking block open, not just the ones opened by hand. */
  thinking: boolean
  /** The details view in place of the timeline. */
  details: boolean
  /** A message being typed at the bottom of the pane. */
  input?: { draft: string; busy: boolean }
  /** A line under the keys: what just happened. */
  notice?: string
  /** What each item drew last time, kept by the caller between paints (`createScreenCache`). */
  cache?: ScreenCache
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
}

const PAD = "   "

type Tool = Extract<Entry, { kind: "tool" }>

/** A row without the padding `fit` put at its end. */
function trimEnd(row: Row): Row {
  const out = [...row]
  while (out.length > 1 && (out.at(-1) as Run).text.trim() === "") out.pop()
  const last = out.at(-1)
  if (last) out[out.length - 1] = { ...last, text: last.text.trimEnd() }
  return out
}

/** A body row, and the item it belongs to. */
export interface Line {
  row: Row
  item?: string
}

export const itemKey = (entry: Entry): string =>
  entry.kind === "tool" ? `tool:${entry.call}` : `${entry.kind}:${entry.key}`

const running = (s: Session) => s.status === "running" || s.status === "starting" || s.status === "waiting"

function timeOf(call: Tool, now: number): string {
  if (call.state === "running" || call.state === "pending") return `running ${elapsed(now - call.at)}`
  const ms = (call.ended ?? call.at) - call.at
  /** A 7 ms read says nothing; a time is shown when it is worth reading. */
  if (ms < 1000) return ""
  return ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : elapsed(ms)
}

/**
 * Calls drawn as OpenCode draws them. A shell command or a file change is a box — its command, then
 * what it printed; everything else (reads, searches, fetches) is one quiet line, and a list of them
 * reads as one list. Opening a line turns it into a box too, with its arguments.
 */
const BOXED = new Set(["bash", "shell", "edit", "write", "patch", "apply_patch", "multiedit"])

/** The glyph and the name OpenCode puts before a call's target. */
function labelOf(name: string): { icon: string; title: string } {
  switch (name) {
    case "read":
      return { icon: "→", title: "Read" }
    case "list":
    case "ls":
      return { icon: "→", title: "List" }
    case "glob":
      return { icon: "✱", title: "Glob" }
    case "grep":
      return { icon: "✱", title: "Grep" }
    case "webfetch":
      return { icon: "%", title: "WebFetch" }
    case "websearch":
      return { icon: "◈", title: "WebSearch" }
    case "edit":
    case "multiedit":
      return { icon: "←", title: "Edit" }
    case "write":
      return { icon: "←", title: "Write" }
    case "patch":
    case "apply_patch":
      return { icon: "←", title: "Patch" }
    case "task":
    case "subagent":
      return { icon: "◉", title: "Task" }
    case "todowrite":
    case "todoread":
      return { icon: "☐", title: "Todos" }
    default:
      return { icon: "⚙", title: name }
  }
}

/** Lines of output a folded box shows, and the most an open one will. */
const PREVIEW = 10
const MOST = 400

function inlineLines(call: Tool, width: number, now: number, frame: number): Line[] {
  const key = itemKey(call)
  const live = call.state === "running" || call.state === "pending"
  const { icon, title } = labelOf(call.name)
  const right = [call.summary ?? "", timeOf(call, now)].filter(Boolean).join(" · ")
  const lines: Line[] = [
    {
      item: key,
      row: spread(
        [
          { text: PAD },
          live
            ? { text: spin(frame), tone: "accent" }
            : { text: icon, tone: call.state === "failed" ? "error" : "muted" },
          { text: ` ${title} `, tone: "text" },
          { text: toolTarget(call.name, call.input), tone: "muted" },
        ],
        right ? [{ text: `${right} `, tone: live ? "accent" : "muted" }] : [],
        width,
      ),
    },
  ]
  if (call.state === "failed" && call.error) {
    lines.push({
      item: key,
      row: fit([{ text: `${PAD}  ` }, { text: call.error.split("\n")[0] ?? "", tone: "error" }], width),
    })
  }
  return lines
}

/**
 * A call as a box: a coloured edge, its own background, the command or the arguments, then the
 * output — ten lines folded, the rest a click away.
 */
function boxLines(call: Tool, width: number, now: number, frame: number, isOpen: boolean): Line[] {
  const key = itemKey(call)
  const live = call.state === "running" || call.state === "pending"
  const failed = call.state === "failed"
  const edge: Run = {
    text: `${PAD.slice(1)}▎`,
    tone: failed ? "error" : live ? "accent" : "border",
    fill: "block",
  }
  const inner = width - widthOf(edge.text) - 3
  const row = (runs: Run[]): Line => ({
    item: key,
    row: fit(
      [edge, { text: "  ", fill: "block" }, ...runs.map((run) => ({ ...run, fill: "block" as const }))],
      width,
    ),
  })
  const blank = () => row([])

  const shell = call.name === "bash" || call.name === "shell"
  const { icon, title } = labelOf(call.name)
  const right = [call.summary ?? "", timeOf(call, now)].filter(Boolean).join(" · ")
  const heading: Run[] = shell
    ? [
        { text: "$ ", tone: "muted" },
        { text: toolTarget(call.name, call.input), tone: "text", bold: true },
      ]
    : [
        { text: `${icon} `, tone: "muted" },
        { text: `${title} `, tone: "text", bold: true },
        { text: toolTarget(call.name, call.input), tone: "text" },
      ]
  const lines: Line[] = [blank()]
  const tail: Run[] = live
    ? [{ text: `${spin(frame)} ${right} `, tone: "accent" }]
    : right
      ? [{ text: `${right} `, tone: failed ? "error" : "muted" }]
      : []
  lines.push({
    item: key,
    row: spread(
      [edge, { text: "  ", fill: "block" }, ...heading.map((run) => ({ ...run, fill: "block" as const }))],
      tail.map((run) => ({ ...run, fill: "block" as const })),
      width,
    ),
  })

  /** A box that is not a shell command shows what it was called with, the way it was called. */
  if (!shell && (isOpen || !BOXED.has(call.name))) {
    const names = Object.keys(call.input)
    const pad = Math.min(14, Math.max(0, ...names.map((name) => name.length)))
    if (names.length > 0) lines.push(blank())
    for (const name of names) {
      const raw = call.input[name]
      const value = typeof raw === "string" ? raw : JSON.stringify(raw)
      wrap(value ?? "", Math.max(8, inner - pad - 2))
        .slice(0, isOpen ? 20 : 3)
        .forEach((text, i) => {
          lines.push(
            row([
              { text: `${i === 0 ? name.padEnd(pad) : " ".repeat(pad)}  `, tone: "muted" },
              { text, tone: "text" },
            ]),
          )
        })
    }
  }

  const output = (call.error ?? call.output ?? "").replace(/\s+$/, "")
  const all = output ? output.split("\n") : []
  const limit = isOpen ? MOST : PREVIEW
  if (all.length > 0) {
    lines.push(blank())
    const shown = live ? all.slice(-limit) : all.slice(0, limit)
    for (const text of shown) lines.push(row([{ text, tone: call.error ? "error" : "text" }]))
    if (all.length > limit)
      lines.push(row([{ text: live ? `… ${all.length - limit} lines above` : "…", tone: "muted" }]))
  }
  if (all.length > PREVIEW && !live) {
    lines.push(blank(), row([{ text: isOpen ? "Click to collapse" : "Click to expand", tone: "muted" }]))
  }
  lines.push(blank())
  return lines
}

/** Whether a call draws as a box, given whether it is open. */
const boxed = (call: Tool, isOpen: boolean): boolean => BOXED.has(call.name) || isOpen

function toolLines(call: Tool, width: number, now: number, frame: number, isOpen: boolean): Line[] {
  return boxed(call, isOpen)
    ? boxLines(call, width, now, frame, isOpen)
    : inlineLines(call, width, now, frame)
}

/**
 * Thinking the way OpenCode shows its own: "Thought · 1.2s", then the words, muted. Folded, the
 * words follow on the same line and are cut there.
 */
function thinkingLines(
  entry: Extract<Entry, { kind: "thinking" }>,
  width: number,
  isOpen: boolean,
  took: number | undefined,
): Line[] {
  const key = itemKey(entry)
  const text = entry.text.replace(/\s+/g, " ").trim()
  const label = entry.done
    ? `Thought${took !== undefined && took >= 100 ? ` · ${duration(took)}` : ""}`
    : "Thinking…"
  if (!isOpen) {
    return [
      {
        item: key,
        row: fit(
          [
            { text: `${PAD}◇ ${label}  `, tone: "warning" },
            { text, tone: "muted", faint: true },
          ],
          width,
        ),
      },
    ]
  }
  const lines: Line[] = [{ item: key, row: fit([{ text: `${PAD}◆ ${label}`, tone: "warning" }], width) }]
  for (const line of wrap(entry.text.trim() || "…", width - PAD.length * 2 - 2)) {
    lines.push({
      item: key,
      row: fit([{ text: `${PAD}  ` }, { text: line, tone: "muted", faint: true }], width),
    })
  }
  return lines
}

/** `590ms`, `1.2s`, `2m04s`. */
function duration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  return ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : elapsed(ms)
}

function cardLines(
  label: string,
  text: string,
  width: number,
  tone: Run["tone"],
  fill: Run["fill"],
  item?: string,
): Line[] {
  const bar: Run = { text: `${PAD}▎ `, tone, fill }
  const lines: Line[] = [
    { ...(item ? { item } : {}), row: fit([bar, { text: label, tone, bold: true, fill }], width) },
  ]
  for (const line of wrap(text, width - PAD.length - 3)) {
    lines.push({ ...(item ? { item } : {}), row: fit([bar, { text: line, tone: "text", fill }], width) })
  }
  return lines
}

function bodyLines(input: ScreenInput, width: number, opened: string[]): Line[] {
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
      case "prompt":
        blank()
        lines.push(
          ...drawn(key, `${width}|${entry.text.length}`, () =>
            cardLines("You", entry.text, width, "info", "card", key),
          ),
        )
        last = { kind: "prompt", open: false }
        return
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
        const box = boxed(entry, isOpen)
        if (last?.kind !== "tool" || last.open || box) blank()
        if (isOpen) opened.push(key)
        /** A running call's spinner and clock change every tick; a finished one never again. */
        const clock = live ? `|${frame}|${Math.floor((now - entry.at) / 1000)}` : ""
        const sig = `${width}|${isOpen}|${entry.state}|${entry.output.length}|${entry.error?.length}|${entry.summary}|${entry.ended}|${Object.keys(entry.input).length}${clock}`
        lines.push(...drawn(key, sig, () => toolLines(entry, width, now, frame, isOpen)))
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
  const glyph: Run =
    session.status === "done"
      ? { text: "●", tone: "success", fill: "band" }
      : session.status === "failed"
        ? { text: "●", tone: "error", fill: "band" }
        : { text: spin(frame), tone: "accent", fill: "band" }
  const state = running(session)
    ? session.status === "waiting"
      ? `waiting ${elapsed(now - session.since)}`
      : `running ${elapsed(now - session.started)}`
    : session.status === "failed"
      ? `failed after ${elapsed((session.ended ?? now) - session.started)}`
      : `done in ${elapsed((session.ended ?? now) - session.started)}`
  const tools = session.entries.filter((entry) => entry.kind === "tool").length
  const meta = [
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
        { text: "▌", tone: "accent", fill: "band" },
        glyph,
        { text: ` ${session.agent.toUpperCase()} `, tone: "info", bold: true, fill: "band" },
        { text: ` ${session.title || "subagent"}`, tone: "text", bold: true, fill: "band" },
      ],
      [
        {
          text: `${state} `,
          tone: running(session) ? "accent" : session.status === "failed" ? "error" : "muted",
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
      const label = cut(`${node.session.agent} ${node.session.title}`, each)
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
      : "it will answer — the main agent is not told"
    return [
      fit(
        [
          { text: `${PAD}┃ `, tone: "accent", fill: "block" },
          { text: input.input.draft, tone: "text", fill: "block" },
          { text: "▍", tone: "accent", fill: "block" },
        ],
        width,
      ),
      spread(
        [{ text: `${PAD}  to ${session.agent} · ${hint}`, tone: "muted" }],
        [
          { text: "enter", tone: "accent" },
          { text: " send  ", tone: "muted" },
          { text: "esc", tone: "accent" },
          { text: " cancel ", tone: "muted" },
        ],
        width,
      ),
    ]
  }
  /** In the order drawn, each with its rank: at half width the lowest-ranked go first. */
  const all: [string, string, number][] = [
    ["j/k", "Select", 5],
    ["enter", "Open", 1],
    ["m", "Message", 2],
    ["x", running(session) ? "Stop" : "Remove", 3],
    ...(running(session) && !session.background ? [["b", "Background", 4] as [string, string, number]] : []),
    ["t", input.thinking ? "Hide thinking" : "Show thinking", 7],
    ["i", input.details ? "Timeline" : "Details", 4],
    ["w", "Width", 6],
    ["esc", "Back", 8],
  ]
  const cost = ([k, what]: [string, string, number]) => k.length + what.length + 5
  let shown = all
  while (shown.length > 1 && PAD.length + shown.reduce((sum, each) => sum + cost(each), 0) > width) {
    const lowest = Math.max(...shown.map((each) => each[2]))
    shown = shown.filter((each) => each[2] !== lowest)
  }
  const keys: Run[] = [
    { text: PAD },
    ...shown.flatMap(([k, what]): Run[] => [
      { text: `[${k}]`, tone: "accent" },
      { text: ` ${what}  `, tone: "text" },
    ]),
  ]
  const note =
    input.notice ??
    (session.status === "done" ? "Finished — it will answer a message, but the main agent is not told." : "")
  return [fit(keys, width), fit([{ text: `${PAD}${note}`, tone: "muted" }], width)]
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
  const body = input.details
    ? detailLines(input, width)
    : mark(bodyLines(input, width, opened), input.selected, width)
  const keys = input.details
    ? []
    : [...new Set(body.map((line) => line.item).filter((item): item is string => Boolean(item)))]
  const most = Math.max(0, body.length - room)
  let first = input.top === undefined ? most : Math.min(Math.max(0, input.top), most)
  /** Keep the selected item in view when the cursor moved onto it. */
  if (input.selected && input.top !== undefined) {
    const at = body.findIndex((line) => line.item === input.selected)
    if (at >= 0 && at < first) first = at
    if (at >= first + room) first = Math.min(most, at - room + 3)
  }
  const shown = body.slice(first, first + room)
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
  }
}

/** For tests and the preview: the columns a row takes. */
export const rowWidth = (row: Row): number => widthOf(row.map((run) => run.text).join(""))
