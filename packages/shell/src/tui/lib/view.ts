import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import type { ScreenRun, ShellInfo } from "@opencode-cockpit/protocol/shell"
import { duration } from "../../core/format.ts"

/** What a human cares about, derived from status + exit code so every surface agrees. */
export type Kind = "run" | "fail" | "stop" | "done"

export function kindOf(s: ShellInfo): Kind {
  if (s.status === "running") return "run"
  if (s.status === "killed") return "stop"
  if (s.status === "exited" && s.exitCode === 0) return "done"
  return "fail"
}

export const BADGE_LABEL: Record<Kind, string> = { run: "RUN", fail: "FAIL", stop: "STOP", done: "DONE" }

/** Braille spinner: single-width in every terminal font. */
export const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

export function kindColor(theme: TuiThemeCurrent, kind: Kind) {
  switch (kind) {
    case "run":
      return theme.success
    case "fail":
      return theme.error
    case "stop":
      return theme.warning
    case "done":
      return theme.textMuted
  }
}

/**
 * The status mark: a coloured rule and its label, in a fixed 7 columns so lists line up.
 *
 * It used to be a filled pill. Filled blocks have to be as wide as their text, so a column of
 * them stacks into a wall of colour that competes with the shell names beside it; a rule carries
 * the same colour in one column and lets the list breathe.
 */
export function badgeText(kind: Kind, frame = 0): string {
  if (kind === "run") return `▌ ${SPINNER[frame % SPINNER.length]} RUN`
  return `▌ ${BADGE_LABEL[kind].padEnd(5)}`
}

/** The rule itself, so it can be coloured apart from the label it marks. */
export const BADGE_RULE = "▌"

const RANK: Record<Kind, number> = { run: 0, fail: 1, stop: 2, done: 3 }

/** Running first (oldest first, stable tabs), then failures, stopped, done (most recent first). */
export function order(list: readonly ShellInfo[]): ShellInfo[] {
  return [...list].sort((a, b) => {
    const ka = kindOf(a)
    const kb = kindOf(b)
    if (ka !== kb) return RANK[ka] - RANK[kb]
    if (ka === "run") return a.startedAt - b.startedAt
    return (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt)
  })
}

export interface PartitionOptions {
  showAll: boolean
  /** Failures stay visible this long after they end. */
  historyMs: number
  now: number
  /** Always visible, so the selection never disappears under the user. */
  keep?: string
}

/** Default view: running shells and recent failures. Everything else folds into a "N more" chip. */
export function partition(list: readonly ShellInfo[], opts: PartitionOptions) {
  const ordered = order(list)
  if (opts.showAll) return { visible: ordered, hidden: [] as ShellInfo[] }
  const visible: ShellInfo[] = []
  const hidden: ShellInfo[] = []
  for (const s of ordered) {
    const kind = kindOf(s)
    const recent = opts.now - (s.endedAt ?? opts.now) <= opts.historyMs
    if (kind === "run" || (kind === "fail" && recent) || s.id === opts.keep) visible.push(s)
    else hidden.push(s)
  }
  return { visible, hidden }
}

export function statusDetail(s: ShellInfo, now: number): string {
  const kind = kindOf(s)
  const ran = duration((s.endedAt ?? now) - s.startedAt)
  const ago = s.endedAt ? since(now - s.endedAt) : ""
  switch (kind) {
    case "run":
      return ran
    case "done":
      return `took ${ran} · ${ago}`
    case "stop":
      return `${stopWord(s)} after ${ran} · ${ago}`
    case "fail":
      if (s.status === "failed") return "could not start"
      return `exit ${s.exitCode ?? "?"} after ${ran} · ${ago}`
  }
}

/** Why it stopped, in one word, because the panel has room for exactly that. */
function stopWord(s: ShellInfo): string {
  switch (s.stopReason) {
    case "timeout":
      return "timed out"
    case "idle":
      return "idle-stopped"
    case "shutdown":
      return "daemon stopped it"
    case "request":
      return s.stoppedBy?.includes("tui") ? "you stopped it" : "agent stopped it"
    default:
      return "stopped"
  }
}

/**
 * Short health label for a watched shell, e.g. "watch tsc ✗" — empty only when nothing watches it.
 *
 * Shown while the watch is still pending too. It used to appear only once the first run finished,
 * so a watched shell looked exactly like a plain one until then — and "is this one being watched"
 * is the question you have before that, not after.
 */
export function watchLabel(s: ShellInfo): string {
  const watch = s.watch
  if (!watch) return ""
  const name = watch.preset && watch.preset !== "watch" ? `watch ${watch.preset}` : "watch"
  if (watch.status === "pending") return `${name} …`
  const mark = watch.status === "ok" ? "✓" : watch.status === "fail" ? "✗" : "?"
  return `${name} ${mark}`
}

export function watchColor(theme: TuiThemeCurrent, s: ShellInfo) {
  switch (s.watch?.status) {
    case "ok":
      return theme.success
    case "fail":
      return theme.error
    /** Pending: still unmistakably a watcher, in the colour the console uses for what is live. */
    case "pending":
      return theme.accent
    default:
      return theme.textMuted
  }
}

/** Compact detail for narrow lists. */
export function shortDetail(s: ShellInfo, now: number): string {
  switch (kindOf(s)) {
    case "run":
      return duration(now - s.startedAt)
    case "fail":
      return s.status === "failed" ? "no start" : `exit ${s.exitCode ?? "?"}`
    case "stop":
      return "stopped"
    case "done":
      return s.endedAt ? since(now - s.endedAt) : "done"
  }
}

/** Coarse relative time: "just now", "12s ago", "9m ago", "3h ago". */
export function since(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 5) return "just now"
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86_400)}d ago`
}

/** The command as the user or agent wrote it, without the `$SHELL -c` wrapper. */
export function displayCommand(s: ShellInfo): string {
  if (s.args.length === 2 && s.args[0] === "-c" && /(^|\/)(ba|z|fi|da|k)?sh$/.test(s.command))
    return s.args[1] as string
  return [s.command, ...s.args].join(" ")
}

/** Folder relative to the project: "" at the root, "./sub" inside, "~/x" elsewhere under home. */
export function relativeCwd(cwd: string, project: string, home = process.env.HOME ?? ""): string {
  const trim = (p: string) => p.replace(/\/+$/, "")
  const c = trim(cwd)
  const p = trim(project)
  if (c === p) return ""
  if (c.startsWith(`${p}/`)) return `./${c.slice(p.length + 1)}`
  if (home && c.startsWith(`${trim(home)}/`)) return `~/${c.slice(trim(home).length + 1)}`
  return c
}

/** Hard-wraps to `width`, at most `maxLines`; the last line ends with … when text was cut. */
export function wrapText(text: string, width: number, maxLines: number): string[] {
  const flat = text.replace(/\s*\n\s*/g, " ⏎ ")
  const w = Math.max(4, width)
  const lines: string[] = []
  for (let i = 0; i < flat.length && lines.length < maxLines; i += w) lines.push(flat.slice(i, i + w))
  if (lines.length === 0) return [""]
  if (flat.length > w * maxLines) {
    const last = lines[lines.length - 1] as string
    lines[lines.length - 1] = `${last.slice(0, w - 1)}…`
  }
  return lines
}

/**
 * Last `rows` styled rows, each cut to `cols`, so colour survives the same trimming as text.
 * `up` moves the window that many rows back from the bottom, for scrolling through history.
 */
export function tailRuns(
  styled: ScreenRun[][] | undefined,
  rows: number,
  cols: number,
  up = 0,
): ScreenRun[][] {
  if (!styled) return []
  const end = Math.max(0, styled.length - Math.max(0, up))
  return styled.slice(Math.max(0, end - rows), end).map((row) => {
    const out: ScreenRun[] = []
    let width = 0
    for (const run of row) {
      if (width >= cols) break
      const text = run.text.slice(0, cols - width)
      width += text.length
      out.push({ ...run, text })
    }
    return out
  })
}

/** Last `rows` lines of screen text, each cut to `cols`; `up` as for `tailRuns`. */
export function tailLines(text: string | undefined, rows: number, cols: number, up = 0): string {
  if (!text) return ""
  const lines = text.split("\n")
  const end = Math.max(0, lines.length - Math.max(0, up))
  return lines
    .slice(Math.max(0, end - rows), end)
    .map((l) => (l.length > cols ? `${l.slice(0, Math.max(0, cols - 1))}…` : l))
    .join("\n")
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text
}

/**
 * One key and what it does.
 *
 * The console used to say `i type · c ^C · r restart · tab screen · / search log`, which is a
 * sentence you have to parse before you can use it — the reader has to work out where each key stops
 * and its description starts. Review settled this already: a bracketed key is a *shape*, recognised
 * rather than read, and it does that work without spending colour, which the console needs for the
 * shells themselves.
 */
export interface KeyHint {
  key: string
  /** Dropped when the console is too narrow for words; the key alone is still a handhold. */
  label: string
  /**
   * `act` does something to the shell in front of you and earns a place on the row whatever the
   * width. `more` moves, switches or manages, and lives in the details panel, which has room to lay
   * it out properly instead of competing for a single line.
   */
  tier: "act" | "more"
}

export interface ConsoleKeysState {
  /** False when no shell is selected, which leaves almost nothing worth offering. */
  shell: boolean
  running: boolean
  view: "log" | "screen" | "details"
  /** A filter is on, so there is something to clear. */
  filtered: boolean
  /** How many shells the console can move between. */
  count: number
  scope: "session" | "project"
  /** Finished shells, which are the only ones `D` would clear. */
  finished: number
  /** Over the whole window rather than in the dialog. */
  full?: boolean
}

/** Only the keys that do something right now: no actions without a target, no concepts from elsewhere. */
export function consoleKeys(state: ConsoleKeysState): KeyHint[] {
  if (!state.shell) {
    return [
      { key: "n", label: "New", tier: "act" },
      { key: "esc", label: "Close", tier: "act" },
    ]
  }
  const keys: KeyHint[] = state.running
    ? [
        { key: "i", label: "Type", tier: "act" },
        { key: "c", label: "^C", tier: "act" },
        { key: "r", label: "Restart", tier: "act" },
        { key: "x", label: "Stop", tier: "act" },
      ]
    : [
        { key: "r", label: "Run Again", tier: "act" },
        { key: "d", label: "Remove", tier: "act" },
      ]
  if (state.view === "log" && state.filtered) keys.push({ key: "⌫", label: "Clear Filter", tier: "more" })
  keys.push({ key: "tab", label: state.view === "log" ? "Screen" : "Log", tier: "more" })
  if (state.view !== "details") keys.push({ key: "/", label: "Search Log", tier: "more" })
  if (state.count > 1) keys.push({ key: "[ ]", label: "Switch Shell", tier: "more" })
  keys.push({
    key: "s",
    label: state.scope === "session" ? "Whole Project" : "This Session",
    tier: "more",
  })
  if (state.finished > 0) keys.push({ key: "D", label: "Clear Done", tier: "more" })
  keys.push({ key: "w", label: state.full ? "Dialog" : "Full Screen", tier: "more" })
  keys.push({ key: "n", label: "New Shell", tier: "more" }, { key: "esc", label: "Close", tier: "more" })
  return keys
}

/**
 * The row under the console: what acts on this shell, and the way to everything else.
 *
 * A footer carrying every key is a wall — nine bracketed keys with no room for their words, which is
 * what it became. These are the ones whose absence would cost a press right now; the rest are a
 * keystroke away and laid out in columns where they can be read.
 */
export function footerHints(state: ConsoleKeysState): KeyHint[] {
  const all = consoleKeys(state)
  const acting = all.filter((hint) => hint.tier === "act")
  if (acting.length === all.length) return all
  return [...acting, { key: "?", label: state.view === "details" ? "Back" : "Details", tier: "act" }]
}

/** Everything the footer left out, for the panel that has room for it. */
export function panelHints(state: ConsoleKeysState): KeyHint[] {
  return consoleKeys(state).filter((hint) => hint.tier === "more")
}

/**
 * The other keys, two to a line.
 *
 * `detailRows` is already a label column and a value column, so the keys join it as rows rather than
 * as a panel of their own — one place to look, one alignment, and the section cannot drift out of
 * step with what the footer offers because both are built from `consoleKeys`.
 */
export function keyRows(hints: readonly KeyHint[], cols: number): [string, string][] {
  if (hints.length === 0) return []
  const cell = (hint: KeyHint) => `${hint.key.padEnd(5)}${hint.label}`
  const cells = hints.map(cell)
  /** The second column starts just past the longest first one — not at half the panel. */
  const gutter = Math.min(
    Math.max(16, Math.floor(Math.max(20, cols - 11) / 2)),
    Math.max(...cells.filter((_, index) => index % 2 === 0).map((text) => text.length)) + 4,
  )
  const rows: [string, string][] = []
  for (let index = 0; index < cells.length; index += 2) {
    const left = cells[index] as string
    const right = cells[index + 1]
    rows.push([index === 0 ? "keys" : "", right ? `${left.padEnd(gutter)}${right}` : left])
  }
  return rows
}

/** The gap between two hints, in cells. Must match what the console actually prints. */
export const HINT_GAP = 3

/**
 * What one hint costs: `[key]`, its label, and the gap after it.
 *
 * The gap was counted as two while the console printed three, so every hint was a cell wider than
 * measured and a row of nine ran a key and a half past the edge. Arithmetic that disagrees with the
 * renderer is worse than no arithmetic: it fits confidently and wrongly.
 */
export const hintWidth = (hint: KeyHint, withLabel: boolean, gap = HINT_GAP): number =>
  hint.key.length + 2 + (withLabel && hint.label ? hint.label.length + 1 : 0) + gap

/** A hint, and whether this row has the width to say what it does. */
export interface FittedHint extends KeyHint {
  labelled: boolean
}

export interface FittedRow {
  hints: FittedHint[]
  /** Keys that did not fit at all. Shown as `…`, so the row never pretends to be the whole list. */
  dropped: number
}

/**
 * As much of the row as fits, giving up the least useful thing first.
 *
 * The keys are already ordered by how often they are wanted, so the last label goes first, then the
 * one before it; only when there are no labels left does a key itself drop. An earlier version was
 * all-or-nothing — one label too many and every label went, leaving a roomy console showing nine
 * bare brackets that said nothing.
 *
 * The final hint is measured without its trailing gap, because nothing follows it.
 */
export function fitHints(hints: readonly KeyHint[], cols: number): FittedRow {
  const fitted: FittedHint[] = hints.map((hint) => ({ ...hint, labelled: true }))
  const width = (): number =>
    fitted.reduce(
      (sum, hint, index) => sum + hintWidth(hint, hint.labelled, index === fitted.length - 1 ? 0 : HINT_GAP),
      0,
    )
  for (let index = fitted.length - 1; index >= 0 && width() > cols; index--) {
    ;(fitted[index] as FittedHint).labelled = false
  }
  /** Room for the `…` that says the row is not the whole list. */
  const ellipsis = 2
  while (fitted.length > 0 && width() > cols - (fitted.length < hints.length ? ellipsis : 0)) fitted.pop()
  return { hints: fitted, dropped: hints.length - fitted.length }
}

/** What one row of the `/shells` list says, as data — the dialog only paints it. */
export interface ShellListItem {
  title: string
  /** The command when the title does not already say it, then where it runs and its watch. */
  description: string
  /** Grouped the way the panel ranks them: what is running first, then what needs a look. */
  category: "Running" | "Watching" | "Failed" | "Finished"
  kind: Kind
  /** `RUN 3m`, `DONE took 2s · 4m ago` — the badge, then the facts. */
  status: string
}

export function shellListItem(s: ShellInfo, now: number, project: string): ShellListItem {
  const kind = kindOf(s)
  const command = displayCommand(s)
  const where = relativeCwd(s.cwd, project)
  const watch = watchLabel(s)
  const said = s.title.trim() === command.trim() ? "" : `$ ${command}`
  return {
    title: s.title,
    description: [said, where ? `in ${where}` : "", watch].filter(Boolean).join(" · "),
    /** A watcher is a different kind of running: it is there to tell you when something breaks. */
    category: kind === "run" ? (s.watch ? "Watching" : "Running") : kind === "fail" ? "Failed" : "Finished",
    kind,
    status: `${BADGE_LABEL[kind]} ${statusDetail(s, now)}`,
  }
}
