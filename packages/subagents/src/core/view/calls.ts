import type { Entry, Node, Session } from "../model/model.ts"
import { ARG_PREVIEW, argumentRows, large } from "./args.ts"
import { markdownRows, plain } from "./markdown.ts"
import { elapsed, fit, type Row, type Run, rowText, spin, spread, widthOf, wrap } from "./rows.ts"
import { type Renderer, rendererOf, type Todo, targetOf, todosOf } from "./tools.ts"

export const PAD = "   "

export type Tool = Extract<Entry, { kind: "tool" }>

/** A row without the padding `fit` put at its end. */
export function trimEnd(row: Row): Row {
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

export const running = (s: Session) =>
  s.status === "running" || s.status === "starting" || s.status === "waiting"

function timeOf(call: Tool, now: number): string {
  if (call.state === "running" || call.state === "pending") return `running ${elapsed(now - call.at)}`
  const ms = (call.ended ?? call.at) - call.at
  /** A 7 ms read says nothing; a time is shown when it is worth reading. */
  if (ms < 1000) return ""
  return ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : elapsed(ms)
}

/**
 * Lines of output a box shows: folded, open, and shown whole (`a`). An open read of a 2,000-line
 * file was 400 rows to scroll through; open now shows enough to see what came back, and all of it is
 * one more key away — capped even then, so one call cannot take over the pane. Arguments climb the
 * same ladder, from `ARG_PREVIEW` rows each.
 */
const PREVIEW = 10
const OPEN = 60
const MOST = 2000

/** How a call is drawn: its row in the table, and what follows its title. */
interface Drawing {
  renderer: Renderer
  target: string
  /** A todo call's list; a todo call without one is drawn generic. */
  todos?: Todo[]
  /** The subagent a `task` call launched, when it can be told. */
  child?: Session
}

export function drawingOf(
  call: Tool,
  servers: readonly string[] | undefined,
  child: Session | undefined,
): Drawing {
  let renderer = rendererOf(call.name, servers)
  const todos = renderer.kind === "todos" ? todosOf(call.input, call.output) : undefined
  if (renderer.kind === "todos" && !todos) renderer = { ...renderer, kind: "generic" }
  const target =
    renderer.kind === "task" && child
      ? [
          child.agent,
          /** OpenCode's "(@explore subagent)" only repeats the agent named just before it. */
          child.title.replace(/\s*\(@[\w.-]+ subagent\)$/, "") || targetOf(call.name, "generic", call.input),
        ]
          .filter(Boolean)
          .join(" · ")
      : targetOf(call.name, renderer.kind, call.input)
  return { renderer, target, ...(todos ? { todos } : {}), ...(child ? { child } : {}) }
}

/**
 * The subagent a `task` call launched: the one OpenCode's answer names (`task_id: ses_…`), or else
 * the only child of this run titled by the call's description. Nothing when it cannot be told —
 * `enter` then opens the call like any other, rather than going to the wrong subagent.
 */
export function childOf(call: Tool, session: Session, nodes: readonly Node[]): Session | undefined {
  const children = nodes.map((node) => node.session).filter((s) => s.parentID === session.id)
  if (children.length === 0) return undefined
  const named = /\bses_[A-Za-z0-9]+/.exec(call.output.slice(0, 2000))?.[0]
  const byId = named ? children.find((s) => s.id === named) : undefined
  if (byId) return byId
  const description = typeof call.input.description === "string" ? call.input.description.trim() : ""
  if (!description) return undefined
  /** OpenCode titles a subagent "<description> (@<agent> subagent)". */
  const titled = children.filter((s) => s.title === description || s.title.startsWith(`${description} (@`))
  return titled.length === 1 ? titled[0] : undefined
}

function inlineLines(call: Tool, drawing: Drawing, width: number, now: number, frame: number): Line[] {
  const key = itemKey(call)
  const live = call.state === "running" || call.state === "pending"
  const { icon, title } = drawing.renderer
  /** A call that leads to a subagent says so; `enter` follows it. */
  const right = [
    [call.summary ?? "", timeOf(call, now)].filter(Boolean).join(" · "),
    drawing.child ? "›" : "",
  ]
    .filter(Boolean)
    .join(" ")
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
          { text: drawing.target, tone: "muted" },
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

/** OpenCode's own marks for a todo's state. */
const TODO: Record<string, { mark: string; tone: Run["tone"]; done?: boolean }> = {
  completed: { mark: "[✓]", tone: "muted", done: true },
  in_progress: { mark: "[•]", tone: "accent" },
  cancelled: { mark: "[-]", tone: "muted", done: true },
  pending: { mark: "[ ]", tone: "muted" },
}

/** A todo call as the list it wrote: one line saying how far along, then the items. */
function todoLines(
  call: Tool,
  drawing: Drawing,
  width: number,
  now: number,
  frame: number,
  limit: number,
): Line[] {
  const key = itemKey(call)
  const todos = drawing.todos ?? []
  const done = todos.filter((todo) => todo.status === "completed").length
  const lines = inlineLines(
    call,
    { ...drawing, target: todos.length > 0 ? `${done}/${todos.length} done` : "empty" },
    width,
    now,
    frame,
  )
  for (const todo of todos.slice(0, limit)) {
    const state = TODO[todo.status] ?? (TODO.pending as (typeof TODO)[string])
    lines.push({
      item: key,
      row: fit(
        [
          { text: `${PAD}  ` },
          { text: `${state.mark} `, tone: state.tone },
          { text: todo.content.replace(/\s+/g, " "), tone: state.done ? "muted" : "text", faint: state.done },
        ],
        width,
      ),
    })
  }
  const more = todos.length - limit
  if (more > 0)
    lines.push({
      item: key,
      row: fit([{ text: `${PAD}  … ${more} more`, tone: "muted" }], width),
    })
  return lines
}

/**
 * A call as a box: a coloured edge, its own background, the command or the arguments, then the
 * output — each climbing the same ladder: a few rows folded, more open, nearly all with `a`, and a
 * line saying what is still hidden.
 */
function boxLines(
  call: Tool,
  drawing: Drawing,
  width: number,
  now: number,
  frame: number,
  isOpen: boolean,
  whole: boolean,
): Line[] {
  const key = itemKey(call)
  const live = call.state === "running" || call.state === "pending"
  const failed = call.state === "failed"
  const { kind, icon, title } = drawing.renderer
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

  const shell = kind === "shell"
  const right = [call.summary ?? "", timeOf(call, now)].filter(Boolean).join(" · ")
  const heading: Run[] = shell
    ? [
        { text: "$ ", tone: "muted" },
        { text: drawing.target, tone: "text", bold: true },
      ]
    : [
        { text: `${icon} `, tone: "muted" },
        { text: `${title} `, tone: "text", bold: true },
        { text: drawing.target, tone: "text" },
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

  /**
   * What it was called with, by type. A shell command's command is its heading; a file change's
   * arguments are its whole contents, shown once you open it; anything else shows them always.
   */
  let args = 0
  /** The last argument that was cut short, so the hint can join the row that says so. */
  let shortened: { at: number; said: string } | undefined
  if (!shell && (isOpen || kind === "generic") && Object.keys(call.input).length > 0) {
    const limit = isOpen ? (whole ? MOST : OPEN) : ARG_PREVIEW
    const drawn = argumentRows(call.input, inner, limit, kind === "file" ? "verbatim" : "markdown")
    args = drawn.most
    lines.push(blank())
    for (const each of drawn.rows) {
      const said = rowText(each).trimEnd()
      if (/^ +… [\d,]+ more lines?$/.test(said)) shortened = { at: lines.length, said }
      lines.push(row(each))
    }
  }

  const output = (call.error ?? call.output ?? "").replace(/\s+$/, "")
  const all = output ? output.split("\n") : []
  const limit = isOpen ? (whole ? MOST : OPEN) : PREVIEW
  /**
   * The hint counts both halves: a folded call with a long argument and no output still says it
   * opens, and `a` is offered when either would show more. A running call's output is its tail, and
   * the spinner already says there is more to come.
   *
   * Keys, not "Click to expand": the pane is driven from the keyboard, and a mouse-only instruction
   * told a keyboard user nothing. `enter` opens and folds the selected call; a click still does too.
   */
  const printed = live ? 0 : all.length
  const opens = printed > PREVIEW || args > ARG_PREVIEW
  const grows = printed > OPEN || args > OPEN
  const hint = !opens
    ? ""
    : !isOpen
      ? "[enter] Expand"
      : grows && !whole
        ? "[a] Show All · [enter] Collapse"
        : "[enter] Collapse"
  let hinted = false
  if (all.length > 0) {
    lines.push(blank())
    const shown = live ? all.slice(-limit) : all.slice(0, limit)
    /** Cut to the pane before anything measures it: a minified file is one enormous line. */
    for (const text of shown)
      lines.push(row([{ text: text.slice(0, width * 2), tone: call.error ? "error" : "text" }]))
    const more = all.length - limit
    /** What it hid and how to see it are one thought, so they are one row. */
    if (more > 0) {
      const said = live
        ? `… ${more.toLocaleString("en")} lines above`
        : `… ${more.toLocaleString("en")} more line${more === 1 ? "" : "s"}`
      hinted = Boolean(hint) && !live
      lines.push(row([{ text: hinted ? `${said} · ${hint}` : said, tone: "muted" }]))
    }
  }
  /** Only an argument was cut: the hint joins the row that says so. */
  if (hint && !hinted && shortened) {
    lines[shortened.at] = row([{ text: `${shortened.said} · ${hint}`, tone: "muted" }])
    hinted = true
  }
  /** Nothing is cut — the call is open and all of it shows: the hint stands on its own. */
  if (hint && !hinted) lines.push(blank(), row([{ text: hint, tone: "muted" }]))
  lines.push(blank())
  return lines
}

/** Whether a call draws as a box, given whether it is open. */
export function boxed(call: Tool, drawing: Drawing, isOpen: boolean, width: number): boolean {
  switch (drawing.renderer.kind) {
    case "shell":
    case "file":
      return true
    case "todos":
      return false
    case "generic":
      return isOpen || large(call.input, width)
    default:
      return isOpen
  }
}

export function toolLines(
  call: Tool,
  drawing: Drawing,
  width: number,
  now: number,
  frame: number,
  isOpen: boolean,
  whole = false,
): Line[] {
  if (drawing.renderer.kind === "todos")
    return todoLines(call, drawing, width, now, frame, isOpen ? (whole ? MOST : OPEN) : PREVIEW)
  return boxed(call, drawing, isOpen, width)
    ? boxLines(call, drawing, width, now, frame, isOpen, whole)
    : inlineLines(call, drawing, width, now, frame)
}

/**
 * Thinking the way OpenCode shows its own: "Thought · 1.2s", then the words, muted. Folded, the
 * words follow on the same line, markup taken out, and are cut there. Open, they are markdown like
 * the answer — a fence, a heading, a list drawn as one — only quieter: every run muted and faint.
 */
export function thinkingLines(
  entry: Extract<Entry, { kind: "thinking" }>,
  width: number,
  isOpen: boolean,
  took: number | undefined,
): Line[] {
  const key = itemKey(entry)
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
            { text: plain(entry.text, width * 4), tone: "muted", faint: true },
          ],
          width,
        ),
      },
    ]
  }
  const lines: Line[] = [{ item: key, row: fit([{ text: `${PAD}◆ ${label}`, tone: "warning" }], width) }]
  for (const row of markdownRows(entry.text.trim() || "…", width - PAD.length, { indent: PAD.length + 2 })) {
    lines.push({
      item: key,
      row: fit(
        row.map((run) => (run.text.trim() === "" ? run : { ...run, tone: "muted" as const, faint: true })),
        width,
      ),
    })
  }
  return lines
}

/** `590ms`, `1.2s`, `2m04s`. */
function duration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  return ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : elapsed(ms)
}

export function cardLines(
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
