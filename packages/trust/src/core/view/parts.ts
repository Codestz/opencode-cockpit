/**
 * The pieces both Trust screens are built from: an agent's chip, a tinted badge, a button, a meter,
 * the week's sparkline, the header and the key list.
 *
 * Colour came back to Trust as signal (docs/building/design-system.md): green is what answers, the
 * warning what is close or needs a look, red what is dangerous. Each piece pairs its colour with a
 * word or a shape — a meter beside `2 of 3`, a badge that says `dangerous` — so none of it is read
 * by colour alone.
 */

import { fitHints, GLYPH, type Hint, keyName } from "@opencode-cockpit/client/design"
import { ago, fit, type Row, type Run, spread, type Tone, widthOf } from "./rows.ts"

export const muted = (text: string): Run => ({ text, tone: "muted" })
export const plain = (text: string): Run => ({ text, tone: "text" })
export const key = (name: string): Run => ({ text: `[${keyName(name)}]`, tone: "accent", bold: true })

/** An agent, as a chip: its name in the info tone on a faint fill of the same. */
export const chip = (agent: string): Run => ({ text: ` ${agent} `, tone: "info", fill: "chip" })

/** A word on a tint of its tone: ` ● answering `, ` dangerous `. */
export const badge = (text: string, tone: "success" | "warning" | "error"): Run => ({
  text: ` ${text} `,
  tone,
  fill: tone === "success" ? "ok" : tone === "warning" ? "warn" : "err",
  bold: true,
})

/**
 * A button: its key, then what it does, on a raised fill — a run you can click as well as a key you
 * can press. `on`: focused, drawn solid in the accent. `off`: nothing to act on here; dimmed rather
 * than removed, because a button that comes and goes cannot be learned.
 */
export function button(name: string, label: string, state: { on?: boolean; off?: boolean } = {}): Run[] {
  if (state.on)
    return [
      { text: ` ${name} `, tone: "ink", fill: "buttonOn", bold: true },
      { text: `${label} `, tone: "ink", fill: "buttonOn" },
    ]
  return [
    { text: ` ${name} `, tone: state.off ? "muted" : "accent", fill: "button", bold: !state.off },
    {
      text: `${label} `,
      tone: state.off ? "muted" : "text",
      fill: "button",
      ...(state.off ? { faint: true } : {}),
    },
  ]
}

/** How close: one `▰` per approval that counts, `▱` for each still to go. Dangerous ones in red. */
export function meter(have: number, need: number, danger: boolean): Run[] {
  const filled = Math.max(0, Math.min(have, need))
  return [
    ...(filled > 0 ? [{ text: "▰".repeat(filled), tone: (danger ? "error" : "success") as Tone }] : []),
    ...(need > filled ? [{ text: "▱".repeat(need - filled), tone: "border" as Tone }] : []),
  ]
}

const BARS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"]

/** A day per cell, scaled to the busiest: a day with none is the empty track, in the border tone. */
export function sparkline(counts: readonly number[]): Run[] {
  const most = Math.max(0, ...counts)
  return counts.map((count) =>
    count === 0 || most === 0
      ? { text: BARS[0] as string, tone: "border" }
      : { text: BARS[Math.max(0, Math.ceil((count / most) * BARS.length) - 1)] as string, tone: "success" },
  )
}

/** `9h`, `2d`, `now`: a time in a column of times, where `ago` on every one says nothing. */
export const since = (ms: number): string => ago(ms).replace(/ ago$/, "")

/** `just now`, `15m ago`. */
export const when = (ms: number): string => {
  const said = ago(ms)
  return said === "now" ? "just now" : said
}

export const plural = (count: number, one: string, many = `${one}s`): string =>
  `${count} ${count === 1 ? one : many}`

export const agentsText = (agents: readonly string[]): string =>
  agents.length <= 1 ? (agents[0] ?? "") : `${agents.slice(0, -1).join(", ")} and ${agents.at(-1)}`

const pad2 = (value: number) => String(value).padStart(2, "0")
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** `09:41` today; `Tue 09:41` this week; `Sep 21` before that. Local time, as a clock on the wall. */
export function clock(at: number, now: number): string {
  const then = new Date(at)
  const time = `${pad2(then.getHours())}:${pad2(then.getMinutes())}`
  const today = new Date(now)
  if (then.toDateString() === today.toDateString()) return time
  if (now - at < 6 * 86_400_000) return `${WEEKDAYS[then.getDay()]} ${time}`
  return `${MONTHS[then.getMonth()]} ${then.getDate()}`
}

/** `today`, `yesterday`, `on Tue`, `on Sep 21`: when, as a day. */
export function dayWord(at: number, now: number): string {
  const then = new Date(at)
  const today = new Date(now)
  if (then.toDateString() === today.toDateString()) return "today"
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (then.toDateString() === yesterday.toDateString()) return "yesterday"
  if (now - at < 6 * 86_400_000) return `on ${WEEKDAYS[then.getDay()]}`
  return `on ${MONTHS[then.getMonth()]} ${then.getDate()}`
}

/* ─── the header and the footer ──────────────────────────────────────────────────────────────── */

/**
 * `Trust · project` on the left; on the right whatever the screen adds, then whether Trust is
 * answering — the first thing to know, so it is a badge: `● answering`, or `○ paused`.
 */
export function headerRow(project: string, paused: boolean, extra: Run[], width: number): Row {
  const state = paused ? badge(`${GLYPH.ring} paused`, "warning") : badge(`${GLYPH.dot} answering`, "success")
  const right: Run[] = [...extra, ...(extra.length > 0 ? [{ text: "  " }] : []), state, { text: " " }]
  /** Narrow, the screen's own words give way before the state does. */
  const fits = widthOf(right.map((run) => run.text).join("")) + 10 <= width
  return spread(
    [{ text: " Trust", tone: "text", bold: true }, ...(project ? [muted(` · ${project}`)] : [])],
    fits ? right : [state, { text: " " }],
    width,
  )
}

/** The keys row: a cell of margin at each end, the way out last and never dropped. */
export function footerRow(hints: readonly Hint[], width: number): Row {
  const fitted = fitHints(hints, Math.max(0, width - 2))
  return fit([{ text: " " }, ...fitted.runs], width)
}

/* ─── the key list ───────────────────────────────────────────────────────────────────────────── */

export interface KeyLine {
  keys: string[]
  does: string
}

/** `runs` wrapped at spaces into rows of `width`, at most `max`; the last says `…` when cut. */
export function wrapRuns(runs: readonly Run[], width: number, max = Number.POSITIVE_INFINITY): Row[] {
  const words: Run[] = []
  for (const run of runs) {
    /** A command shown as an example is not broken across rows when it fits on one. */
    if (
      (run.tone === "text" || (run.fill !== undefined && run.fill !== "none")) &&
      widthOf(run.text) <= width
    ) {
      words.push(run)
      continue
    }
    for (const part of run.text.split(/(?<= )/)) if (part !== "") words.push({ ...run, text: part })
  }
  const lines: Row[] = [[]]
  let used = 0
  for (const word of words) {
    const w = widthOf(word.text.trimEnd())
    if (used > 0 && used + w > width) {
      lines.push([])
      used = 0
    }
    ;(lines.at(-1) as Row).push(word)
    used += widthOf(word.text)
  }
  /** A row's last space is not part of it: counted, it pushed a word that fit exactly into `…`. */
  for (const line of lines) {
    const last = line.at(-1)
    if (last && !last.fill) line[line.length - 1] = { ...last, text: last.text.trimEnd() }
  }
  if (lines.length <= max) return lines.map((line) => fit(line, width))
  const kept = lines.slice(0, max)
  const rest = lines.slice(max).flat()
  /** The overflow joins the last row, which `fit` then cuts with `…`; the space its end lost goes back. */
  kept[max - 1] = [...(kept[max - 1] as Row), { text: " " }, ...rest]
  return kept.map((line) => fit(line, width))
}

/** Every key a screen takes, one line each, what each does wrapped under its column rather than cut. */
export function keyListRows(list: readonly KeyLine[], width: number): Row[][] {
  const column = Math.max(
    ...list.map((each) => widthOf(each.keys.map((name) => `[${keyName(name)}]`).join(" "))),
  )
  const indent = 1 + column + 3
  return list.map((each) => {
    const keys = each.keys.flatMap((name, at): Run[] => [...(at > 0 ? [{ text: " " }] : []), key(name)])
    const pad = " ".repeat(column - widthOf(keys.map((run) => run.text).join("")) + 3)
    return wrapRuns([plain(each.does)], Math.max(1, width - indent - 1)).map((row, at) =>
      fit(
        [
          { text: " " },
          ...(at === 0 ? [...keys, { text: pad }] : [{ text: " ".repeat(indent - 1) }]),
          ...row,
        ],
        width,
      ),
    )
  })
}

/** As many key lines as fit in `room` rows; a list cut short says how many keys are below. */
export function keyListBody(list: readonly KeyLine[], width: number, room: number): Row[] {
  const each = keyListRows(list, width)
  const rows: Row[] = []
  let shown = 0
  for (const rowsOf of each) {
    const last = shown === each.length - 1
    if (rows.length + rowsOf.length > (last ? room : room - 1)) break
    rows.push(...rowsOf)
    shown++
  }
  if (shown < each.length)
    rows.push(fit([muted(` ↓ ${plural(each.length - shown, "more key")} below`)], width))
  while (rows.length < room) rows.push(fit([], width))
  return rows.slice(0, room)
}

/* ─── where a click lands ────────────────────────────────────────────────────────────────────── */

/** Something on screen a click acts on: a row to select, or a button to press. */
export type Hit =
  /** `x0`/`x1`: the columns it covers, when it does not take the whole row. */
  | { kind: "row"; y: number; key: string; x0?: number; x1?: number }
  | { kind: "button"; y: number; x0: number; x1: number; action: string }

/** The buttons in a row of runs, by where each starts and ends. `actions`: one per button, in order. */
export function buttonHits(row: Row, y: number, actions: readonly string[]): Hit[] {
  const hits: Hit[] = []
  let x = 0
  let at = -1
  let open: { x0: number } | undefined
  for (const run of row) {
    const w = widthOf(run.text)
    const isButton = run.fill === "button" || run.fill === "buttonOn"
    if (isButton && !open) {
      open = { x0: x }
      at++
    }
    if (!isButton && open) {
      const action = actions[at]
      if (action) hits.push({ kind: "button", y, x0: open.x0, x1: x, action })
      open = undefined
    }
    x += w
  }
  if (open) {
    const action = actions[at]
    if (action) hits.push({ kind: "button", y, x0: open.x0, x1: x, action })
  }
  return hits
}
