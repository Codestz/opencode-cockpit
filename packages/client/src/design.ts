/**
 * The terminal design every bay shares: which tone a state wears, which glyph means what, and how a
 * row of keys is written and cut to fit.
 *
 * Each bay grew its own copy of these, and the copies drifted within a release: green meant
 * *running* in Shell and *done* in Subagents in the same sidebar, brackets meant keys in one place
 * and a status in another, and a footer too narrow for its keys dropped the way out in three bays
 * and said so in one. One module is the only way they stay the same, because a copy cannot drift
 * from something it imports.
 *
 * Pure on purpose: strings, tone *names* and numbers. No OpenTUI, no colours — a tone is a meaning,
 * and what it looks like is the user's theme, decided in each bay's one render file. Nothing here
 * asks a bay to change its own `Run` or `Row`: the shapes below are the few fields every bay's run
 * already has, so a bay passes them straight through.
 *
 * The reasons behind every decision are in docs/building/design-system.md.
 */

// ── States ─────────────────────────────────────────────────────────────────────────────────────

/**
 * What a thing is doing, in the words every bay can agree on. A bay maps its own states onto these
 * once (Shell's `run`/`fail`/`stop`/`done`, a subagent's activity, a thread's turn) and takes the
 * tone, the mark and the word from here.
 */
export type State =
  /** Working now. The spinner says it is live; the tone says it is the thing in motion. */
  | "running"
  /** Held until *you* act: a permission, your turn in a thread. The one state that asks for you. */
  | "waiting"
  /** Finished, and it did not work: a non-zero exit, an error. */
  | "failed"
  /** Ended before it finished, on purpose: you, the agent, a timeout. Not a failure. */
  | "stopped"
  /** Finished, and it worked. */
  | "done"
  /** Nothing happening and nothing wrong. */
  | "idle"

/** The tones a state may wear. Every bay's own `Tone` has these names. */
export type StateTone = "accent" | "warning" | "error" | "muted"

/**
 * One state, one tone, in every bay — and colour only where it asks something of you.
 *
 * Running is the accent: the thing in motion. Waiting is the warning: the one state that needs you.
 * Failed is the error. Everything that has simply ended — done, stopped — is muted, because a
 * finished thing asks nothing; a sidebar of seven finished subagents drawn in the success colour
 * was seven coloured dots saying nothing at all, beside a spend figure in the same colour.
 *
 * Stopped is not failed. A run you cancelled was drawn with a red dot, an orange word and a red
 * `1 failed` in the heading — one event, three states. It is its own state, and quiet.
 */
export const STATE_TONE: Readonly<Record<State, StateTone>> = {
  running: "accent",
  waiting: "warning",
  failed: "error",
  stopped: "muted",
  done: "muted",
  idle: "muted",
}

export const toneOf = (state: State): StateTone => STATE_TONE[state]

/**
 * The word for a state, where a word is wanted. `stopped`, not `cancelled`: one word for "ended on
 * purpose" whoever ended it, and the one Shell already used.
 */
export const STATE_WORD: Readonly<Record<State, string>> = {
  running: "running",
  waiting: "needs you",
  failed: "failed",
  stopped: "stopped",
  done: "done",
  idle: "idle",
}

// ── Gauges ─────────────────────────────────────────────────────────────────────────────────────

/** A measurement against a limit: how full the context is, how much of a budget is spent. */
export type GaugeTone = "success" | "warning" | "error"

/** Where a gauge stops being calm. Three quarters, then nine tenths, as the context bar has always used. */
export const GAUGE = { warnAt: 0.75, dangerAt: 0.9 } as const

/**
 * The tone of a gauge's fill: calm until the warning threshold, then the warning, then the error.
 *
 * Three steps and two documented numbers, so the colour can be read. A gradient was the other
 * option and the screenshots that retired it showed why: a bar green at 13% and olive at 12% is a
 * colour nobody can decode. Calm is the success tone — the one thing it means outside a gauge is a
 * check that passed, which is the same sentence: there is room.
 */
export function gaugeTone(
  ratio: number,
  warnAt: number = GAUGE.warnAt,
  dangerAt: number = GAUGE.dangerAt,
): GaugeTone {
  if (ratio >= dangerAt) return "error"
  if (ratio >= warnAt) return "warning"
  return "success"
}

// ── Glyphs ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Braille spinner frames. Every one is a single cell in every terminal font, which is why it won
 * over the circle and arrow spinners that draw half a cell wide or as tofu.
 */
export const SPINNER: readonly string[] = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

export const spinner = (frame: number): string =>
  SPINNER[Math.abs(Math.trunc(frame)) % SPINNER.length] as string

/**
 * One glyph per meaning, and one meaning per glyph.
 *
 * The rule for adding one: it must be a single cell wide in every terminal a user is likely to run,
 * which rules out two families.
 *
 * - **Nerd Font glyphs** (the Private Use Area, U+E000–U+F8FF and above U+F0000) draw as tofu
 *   wherever the font is not patched. Never.
 * - **Anything with an emoji presentation** — `⚠ ✔ ✖ ❌ ⭐ ⏱` — is drawn two cells wide by any
 *   terminal that falls back to a colour emoji font, and pushes every column after it one cell
 *   right. In a grid, never; `!` in the warning tone says "warning" in one cell everywhere.
 *
 * Box drawing, block elements and geometric shapes (`─ │ ▌ ● ○`) are East Asian *ambiguous* width:
 * one cell unless a terminal is set to draw ambiguous characters wide, which breaks OpenCode's own
 * interface just as badly. They are used, and that is the trade.
 */
export const GLYPH = {
  /** A thing that has ended; its tone says whether that needs you. */
  dot: "●",
  /** A thing that is not moving: waiting on you, or not started. */
  ring: "○",
  /** A check that passed (a watch, a doctor check) and a ticked checkbox. Not a state mark. */
  check: "✓",
  /** A check that failed. */
  cross: "✗",
  /** A warning, one cell wide everywhere. Never `⚠`. */
  warn: "!",
  /** Something was cut or dropped here. Never three dots. */
  more: "…",
  /** The item under the cursor, in the margin cell beside it. That is all `▌` ever means. */
  cursor: "▌",
  /** The edge of a block that belongs together: a quoted task, a call's box. */
  edge: "▎",
  /** Where typing goes, or where words are still arriving. */
  caret: "▍",
  /** A fold that is closed, and one that is open. */
  folded: "▸",
  unfolded: "▾",
} as const

/**
 * The mark in front of a name: a spinner while it runs, a ring while it waits, a dot once it ends.
 *
 * A mark never stands alone — colour cannot be the only thing that says failed rather than done —
 * so wherever a mark is drawn, a word or the row's shape says the state too.
 */
export function stateMark(state: State, frame = 0): { text: string; tone: StateTone } {
  const tone = toneOf(state)
  if (state === "running") return { text: spinner(frame), tone }
  if (state === "waiting" || state === "idle") return { text: GLYPH.ring, tone }
  return { text: GLYPH.dot, tone }
}

/**
 * A checkbox: `[✓]` or `[ ]`. Brackets mean two things in this interface — a key you can press and
 * a box you can tick — and nothing else. A status is a bare word in its tone, never `[WAITING]`.
 */
export const checkbox = (on: boolean): string => (on ? `[${GLYPH.check}]` : "[ ]")

// ── Sidebar blocks ─────────────────────────────────────────────────────────────────────────────

/** A run of a summary. As with hints, every bay's own run has these fields. */
export interface ToneRun {
  text: string
  tone?: StateTone | "text"
  bold?: boolean
}

/**
 * The order a heading's counts read in: what is happening, then how things ended. Failures last, at
 * the edge where the eye stops — `6 done · 1 failed`.
 */
const SUMMARY_ORDER: readonly State[] = ["running", "waiting", "done", "stopped", "failed"]
/** What gives way first when the heading is narrow: history, then motion; never what needs you. */
const SUMMARY_DROP: readonly State[] = ["done", "stopped", "running", "failed", "waiting"]

/**
 * What a sidebar block's heading says on its right: every state there is a count of, each in its
 * tone, in at most `room` cells.
 *
 * It used to name only the worst — `1 failed` with six done beside it, `7 done` once everything
 * had ended — and each bay worded it differently (`2 run · 1 fail` beside `2 running`). Now it is
 * every count, the least urgent dropped first when the column is narrow.
 */
export function summaryRuns(counts: Partial<Record<State, number>>, room: number): ToneRun[] {
  let shown = SUMMARY_ORDER.filter((state) => (counts[state] ?? 0) > 0)
  const draw = (states: readonly State[]): ToneRun[] =>
    states.flatMap((state, at): ToneRun[] => [
      ...(at > 0 ? [{ text: " · ", tone: "muted" as const }] : []),
      { text: `${counts[state]} ${STATE_WORD[state]}`, tone: toneOf(state) },
    ])
  const size = (states: readonly State[]) => draw(states).reduce((sum, run) => sum + run.text.length, 0)
  for (const state of SUMMARY_DROP) {
    if (shown.length <= 1 || size(shown) <= room) break
    shown = shown.filter((each) => each !== state)
  }
  return draw(shown)
}

/**
 * The heading of a sidebar block: its name, bold, on the left; the summary flush right; nothing
 * under it but its first row. Shells drew a row of air under its heading and the Subagents block
 * did not, so the two blocks stacked in one column looked like two products.
 */
export const HEADING = { tone: "text", bold: true } as const

/** What a block says about the rows it is not showing. Expandable or not, one wording. */
export const moreText = (count: number): string => `+ ${count} more`

/** What an expanded block offers to fold back. */
export const FEWER_TEXT = "− fewer"

/**
 * How long something ran, in the fewest characters that still read: `4s`, `51s`, `2m04s`, `1h12m`.
 *
 * One kind of time in a sidebar column. Shells said `4m ago` beside a subagent's `28m08s`, so the
 * column meant "since" in one block and "for" in the next; both now say how long it ran.
 */
export function duration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${String(s % 60).padStart(2, "0")}s`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`
}

// ── Keys ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Named keys are lowercase words: `tab`, `esc`, `enter`, `space`. A letter keeps its case, because
 * `B` is shift-b and means something `b` does not. The aliases are what each bay's keymap or a
 * habit might hand in, so `[Tab]` and `[return]` cannot reach the screen.
 */
const KEY_NAMES: Readonly<Record<string, string>> = {
  tab: "tab",
  esc: "esc",
  escape: "esc",
  enter: "enter",
  return: "enter",
  space: "space",
  backspace: "backspace",
  delete: "delete",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
  pageup: "pgup",
  pagedown: "pgdn",
}

export function keyName(key: string): string {
  return key
    .split("/")
    .map((part) => {
      if (part.length <= 1) return part
      const parts = part.split("+")
      const last = parts.pop() as string
      const named = KEY_NAMES[last.toLowerCase()] ?? last
      return [...parts.map((mod) => mod.toLowerCase()), named].join("+")
    })
    .join("/")
}

/** The key that leaves a surface, in every bay. `q` stays bound where it already worked. */
export const CLOSE_KEY = "esc"

/**
 * Labels are Title Case, so a row of them reads as a row of names: `All Updates`, `Hide Thinking`,
 * not a mix of `All updates` and `Note File`. Symbols (`^C`) pass through.
 */
export const labelCase = (label: string): string =>
  label.replace(/(^|[\s/])([a-z])/g, (_, before: string, first: string) => `${before}${first.toUpperCase()}`)

// ── Hints ──────────────────────────────────────────────────────────────────────────────────────

/** One key and what it does, as a footer offers it. */
export interface Hint {
  key: string
  label: string
  /**
   * How much it is wanted. Higher survives a narrow row; equal ones go right to left. Unset, a hint
   * ranks by where it stands — the first most wanted — which is the order rows are written in.
   */
  priority?: number
  /** The way out. Never dropped, and always last in the row. */
  close?: boolean
  /**
   * On screen but with nothing to act on yet (Review's `[s] Submit` with no notes). Dimmed rather
   * than removed: a key that comes and goes cannot be learned.
   */
  off?: boolean
}

/** A run of a hint row. Every bay's own run has these fields, so these pass straight through. */
export interface HintRun {
  text: string
  tone?: "accent" | "muted"
  bold?: boolean
  faint?: boolean
}

/** The space between two hints. Three, because two read as one phrase at a glance. */
export const HINT_GAP = 3

/** The way out, as every bay offers it. */
export const closeHint = (label = "Close"): Hint => ({ key: CLOSE_KEY, label, close: true })

/** `[key] Label`: the key bright and bold, the label muted — a shape recognised rather than read. */
export function hintRuns(hint: Hint, labelled = true): HintRun[] {
  const key: HintRun = hint.off
    ? { text: `[${keyName(hint.key)}]`, tone: "muted", faint: true }
    : { text: `[${keyName(hint.key)}]`, tone: "accent", bold: true }
  if (!labelled || !hint.label) return [key]
  return [key, { text: ` ${labelCase(hint.label)}`, tone: "muted", ...(hint.off ? { faint: true } : {}) }]
}

const width = (runs: readonly HintRun[]): number => runs.reduce((sum, run) => sum + run.text.length, 0)

export interface FittedHints {
  /** Exactly `width` cells: the hints kept, `…` if any were dropped, the way out, then padding. */
  runs: HintRun[]
  /** The hints shown, in the order drawn. */
  shown: Hint[]
  /** How many did not fit. Never the way out. */
  dropped: number
}

/**
 * A row of hints, cut to exactly `width` cells by giving up the least wanted thing first.
 *
 * Three promises, because each was broken somewhere before this existed:
 *
 * - **The way out is never dropped.** "How do I leave" is the first question anyone asks of a
 *   surface that has taken over the screen, and clipping from the right made it the first key to
 *   go — in Review at a hundred columns, in Subagents at half a pane, in the Updater at sixty.
 * - **A row that lost keys says so with `…`.** Shell's footer did; the other three dropped keys
 *   silently, so a row of three keys looked like the whole list.
 * - **Whole hints only.** Half a hint is a label with no key, or a key with half a word.
 *
 * Only when the way out alone is too wide does its label go, and only past that is it cut.
 */
export function fitHints(hints: readonly Hint[], room: number): FittedHints {
  const target = Math.max(0, room)
  const ranked = hints.map((hint, index) => ({
    hint,
    index,
    rank: hint.priority ?? hints.length - index,
  }))
  const close = ranked.filter((each) => each.hint.close)
  let kept = ranked.filter((each) => !each.hint.close)
  const total = kept.length

  const draw = (labelClose: boolean): HintRun[] => {
    const runs: HintRun[] = []
    const gap = () => {
      if (runs.length > 0) runs.push({ text: " ".repeat(HINT_GAP) })
    }
    for (const each of kept) {
      gap()
      runs.push(...hintRuns(each.hint))
    }
    if (kept.length < total) {
      gap()
      runs.push({ text: "…", tone: "muted" })
    }
    for (const each of close) {
      gap()
      runs.push(...hintRuns(each.hint, labelClose))
    }
    return runs
  }

  while (kept.length > 0 && width(draw(true)) > target) {
    const lowest = Math.min(...kept.map((each) => each.rank))
    const at = kept.findLastIndex((each) => each.rank === lowest)
    kept = kept.filter((_, index) => index !== at)
  }
  let runs = draw(true)
  if (width(runs) > target) runs = draw(false)

  /** Exactly the room: cut what still overflows, pad what falls short. */
  const out: HintRun[] = []
  let used = 0
  for (const run of runs) {
    const left = target - used
    if (left <= 0) break
    if (run.text.length <= left) {
      out.push(run)
      used += run.text.length
    } else {
      out.push({ ...run, text: left > 1 ? `${run.text.slice(0, left - 1)}…` : "…" })
      used = target
    }
  }
  if (used < target) out.push({ text: " ".repeat(target - used) })
  return {
    runs: out,
    shown: [...kept.map((each) => each.hint), ...close.map((each) => each.hint)],
    dropped: total - kept.length,
  }
}
