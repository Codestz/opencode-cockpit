/** Formatting for a line where every column costs something. */

/** 1234 → "1.2k", 1_200_000 → "1.2M". Whole numbers below 1000 stay as they are. */
export function compact(n: number): string {
  const abs = Math.abs(n)
  if (abs < 1000) return String(Math.round(n))
  if (abs < 1_000_000) return `${trim(n / 1000)}k`
  if (abs < 1_000_000_000) return `${trim(n / 1_000_000)}M`
  return `${trim(n / 1_000_000_000)}B`
}

function trim(n: number): string {
  const one = n.toFixed(1)
  return one.endsWith(".0") ? one.slice(0, -2) : one
}

/**
 * Money, at the precision the amount deserves: cents matter at $0.42, they do not at $124.
 * Sub-cent spend reads as "<$0.01" rather than "$0.00", which looks like nothing was spent.
 */
export function money(amount: number, currency = "$"): string {
  if (amount <= 0) return `${currency}0`
  if (amount < 0.01) return `<${currency}0.01`
  if (amount < 100) return `${currency}${amount.toFixed(2)}`
  return `${currency}${Math.round(amount)}`
}

/** "4s", "3m", "2h 5m" — a statusline has no room for "2 hours, 5 minutes". */
export function duration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest === 0 ? `${h}h` : `${h}h ${rest}m`
}

/** A percentage with no decimal point, because the last digit never changes a decision. */
export function percent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}

const BLOCKS = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"]

/** A fractional bar: "███▌  ". Width is in cells, and the result is always exactly that wide. */
export function bar(ratio: number, width: number): string {
  const w = Math.max(0, Math.floor(width))
  if (w === 0) return ""
  const clamped = Math.min(1, Math.max(0, ratio))
  const exact = clamped * w
  const full = Math.floor(exact)
  const part = BLOCKS[Math.floor((exact - full) * BLOCKS.length)] ?? ""
  return `${"█".repeat(full)}${part}`.padEnd(w, " ").slice(0, w)
}

/**
 * The path as a person would say it: "" at the worktree root, "src/tui" inside it, "~/other"
 * elsewhere under home, and the plain path otherwise.
 */
export function shortPath(directory: string, worktree: string, home: string): string {
  const trim = (p: string) => p.replace(/\/+$/, "")
  const dir = trim(directory)
  const root = trim(worktree)
  if (dir === root) return basename(root)
  if (root && dir.startsWith(`${root}/`)) return dir.slice(root.length + 1)
  const h = trim(home)
  if (h && dir === h) return "~"
  if (h && dir.startsWith(`${h}/`)) return `~/${dir.slice(h.length + 1)}`
  return dir
}

export function basename(path: string): string {
  const parts = path.replace(/\/+$/, "").split("/")
  return parts[parts.length - 1] || path
}

/**
 * Model ids carry a vendor prefix and a date nobody reads at a glance
 * ("anthropic/claude-opus-5-20260101" → "claude-opus-5").
 */
export function shortModel(modelID: string): string {
  const tail = modelID.includes("/") ? (modelID.split("/").pop() as string) : modelID
  return tail.replace(/-\d{8}$/, "").replace(/-latest$/, "")
}

/**
 * Cuts from the left, keeping the end. For a path the tail is what identifies it: "…/src/tui"
 * says where you are, "/Users/me/very/lo…" does not.
 */
export function truncateStart(text: string, max: number): string {
  if (max <= 0) return ""
  if (text.length <= max) return text
  if (max === 1) return "…"
  return `…${text.slice(text.length - (max - 1))}`
}

/** Cuts to `max` cells, marking the cut. Never returns more than `max`. */
export function truncate(text: string, max: number): string {
  if (max <= 0) return ""
  if (text.length <= max) return text
  if (max === 1) return "…"
  return `${text.slice(0, max - 1)}…`
}

/* --------------------------------------------------------------------- colour */

type Rgb = [number, number, number]

/** Green, through amber, to red: the gradient a capacity bar is read against. */
const HEAT: Rgb[] = [
  [46, 204, 113],
  [241, 196, 15],
  [231, 76, 60],
]

function hex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((n) => Math.round(n).toString(16).padStart(2, "0")).join("")}`
}

/**
 * The colour at `t` (0..1) along a gradient, interpolated rather than bucketed. A bar whose cells
 * step smoothly from green to red reads as a measurement; one that flips between three colours
 * reads as three states.
 */
export function gradient(t: number, stops: Rgb[] = HEAT): string {
  const clamped = Math.min(1, Math.max(0, t))
  if (stops.length === 0) return "#ffffff"
  if (stops.length === 1) return hex(stops[0] as Rgb)
  const span = 1 / (stops.length - 1)
  const index = Math.min(stops.length - 2, Math.floor(clamped / span))
  const from = stops[index] as Rgb
  const to = stops[index + 1] as Rgb
  const local = (clamped - index * span) / span
  return hex([
    from[0] + (to[0] - from[0]) * local,
    from[1] + (to[1] - from[1]) * local,
    from[2] + (to[2] - from[2]) * local,
  ])
}

/**
 * "3m42s" while you are watching it, "2d 13h" once you are not.
 *
 * Each tier drops the one below as it stops mattering: seconds are worth watching in the first
 * minute and meaningless after an hour, and "61h48m" is a number nobody converts in their head.
 */
export function preciseDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const s = total % 60
  const m = Math.floor(total / 60) % 60
  const h = Math.floor(total / 3600) % 24
  const d = Math.floor(total / 86_400)
  if (d > 0) return h === 0 ? `${d}d` : `${d}d ${h}h`
  if (total >= 3600) return `${Math.floor(total / 3600)}h${String(m).padStart(2, "0")}m`
  if (m > 0) return `${m}m${String(s).padStart(2, "0")}s`
  return `${s}s`
}

/**
 * Filling `{name}` placeholders from a segment's own values.
 *
 * This is what a `format` setting runs on. A segment that draws several figures should not also
 * decide the words between them — "3f +12 -4" suits one line and "+12/-4" another, and neither is
 * ours to insist on. An unknown placeholder is left as written, so a typo is visible rather than
 * silently blank.
 */
export function template(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole))
}
