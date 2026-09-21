import { BUILTINS } from "./builtins/index.ts"
import type { SegmentConfig } from "./config.ts"
import type { StatusContext } from "./context.ts"
import type { Piece, Pieces, Run, Segment, SegmentDef, Tone } from "./types.ts"

/**
 * Turning a line's configuration into the segments a surface draws. The segment model itself lives
 * in `types.ts` and the built-ins in `builtins/`; this file is only the assembly.
 */

export type { Piece, Pieces, Run, Segment, SegmentDef, Tone } from "./types.ts"
export { BUILTINS }

export function runsOf(piece: Piece): Run[] {
  return "runs" in piece ? piece.runs : [{ text: piece.text, tone: piece.tone, color: piece.color }]
}

export function segmentText(segment: Segment): string {
  return segment.runs.map((run) => run.text).join("")
}

export function segmentWidth(segment: Segment): number {
  let width = 0
  for (const run of segment.runs) width += run.text.length
  return width
}

/** Cuts a segment to `max` cells, keeping each run's styling up to the cut. */
export function cutSegment(segment: Segment, max: number): Segment {
  if (max <= 0) return { ...segment, runs: [] }
  const runs: Run[] = []
  let width = 0
  for (const run of segment.runs) {
    if (width >= max) break
    const room = max - width
    if (run.text.length <= room) {
      runs.push(run)
      width += run.text.length
      continue
    }
    // The cut lands inside this run: keep what fits, minus a cell for the ellipsis.
    const text = room <= 1 ? "…" : `${run.text.slice(0, room - 1)}…`
    runs.push({ ...run, text })
    width += text.length
    break
  }
  return { ...segment, runs }
}

const BY_NAME = new Map(BUILTINS.map((def) => [def.name, def]))

/**
 * Names that changed, kept working. `git.diff` read as "what git would tell me", when it has
 * always been what this session changed.
 */
/** `session.diff` was the name while the numbers came from the host; both still resolve. */
const ALIASES: Record<string, string> = { "session.diff": "git.diff" }

for (const [from, to] of Object.entries(ALIASES)) {
  const def = BY_NAME.get(to)
  if (def) BY_NAME.set(from, def)
}

export function findSegment(type: string): SegmentDef | undefined {
  return BY_NAME.get(type)
}

/**
 * Builds the line's segments in order, dropping the ones with nothing to say. An unknown type is
 * dropped too rather than drawn as an error: a stale config should cost you a segment, not a line.
 */
export interface BuildOptions {
  custom?: ReadonlyMap<string, SegmentDef>
  /** Icons are on by default; a terminal without the glyphs can switch them off. */
  icons?: boolean
  /**
   * Draw a placeholder where a segment chose to say nothing, and mark names nothing answers to.
   *
   * The rule that a segment with nothing to say says nothing is right while you are working and
   * miserable while you are configuring: a typo, a proxy that declared no context window, and a
   * model with no prices all look identical, because all three look like absence. This makes the
   * three distinguishable for as long as it is on.
   */
  debug?: boolean
}

export function buildSegments(
  ctx: StatusContext,
  configs: SegmentConfig[],
  options: BuildOptions | ReadonlyMap<string, SegmentDef> = {},
): Segment[] {
  // A bare map is accepted so the common case reads as `buildSegments(ctx, configs, custom)`.
  const {
    custom,
    icons = true,
    debug = false,
  } = options instanceof Map ? ({ custom: options } as BuildOptions) : (options as BuildOptions)
  const out: Segment[] = []
  const seen = new Map<string, number>()

  for (const config of configs) {
    // Your own segments are looked up first, so a module can replace a built-in by name.
    const def = custom?.get(config.type) ?? findSegment(config.type)
    if (!def) {
      // A name nothing answers to: a typo, or a segment from a module that failed to load.
      if (debug) out.push(marker(`?${config.type}`, "error", config.type, seen))
      continue
    }
    let piece: Pieces | undefined
    try {
      piece = def.render(ctx, config)
    } catch {
      // A segment that throws costs its own place on the line and nothing else.
      if (debug) out.push(marker(`!${config.type}`, "error", config.type, seen))
      continue
    }
    if (!piece) {
      // It ran and chose silence: the input it needs is missing, not its name.
      if (debug) out.push(marker(config.type, "border", config.type, seen))
      continue
    }

    const wanted = typeof config.color === "string" ? config.color : undefined
    const forcedTone = wanted ? toTone(wanted) : undefined
    const forcedColor = wanted && isLiteralColor(wanted) ? wanted : undefined

    // Several rows are placed one after another: down a column each is a row of its own.
    const pieces = Array.isArray(piece) ? piece : [piece]
    let drew = false
    for (const one of pieces) {
      const runs = runsOf(one).filter((run) => run.text.length > 0)
      if (runs.length === 0) continue

      const icon = typeof config.icon === "string" ? config.icon : icons ? def.icon : undefined
      const prefix = typeof config.prefix === "string" ? config.prefix : ""
      const suffix = typeof config.suffix === "string" ? config.suffix : ""
      // The icon gets its own run so it can be dimmed apart from the value it labels.
      if (icon) runs.unshift({ text: `${icon} `, tone: runs[0]?.tone, dim: true })
      if (prefix) runs.unshift({ text: prefix, tone: runs[0]?.tone })
      if (suffix) runs.push({ text: suffix, tone: runs[runs.length - 1]?.tone })

      // A colour named on the segment overrides every run in it, icon included; that is what makes
      // `{"type": "cost", "color": "#ff8800"}` do what it looks like it should.
      const styled =
        forcedTone || forcedColor
          ? runs.map((run) => ({
              ...run,
              ...(forcedTone ? { tone: forcedTone } : {}),
              ...(forcedColor ? { color: forcedColor } : {}),
            }))
          : runs

      const count = (seen.get(config.type) ?? 0) + 1
      seen.set(config.type, count)
      out.push({
        id: count === 1 ? config.type : `${config.type}#${count}`,
        runs: styled,
        priority: typeof config.priority === "number" ? config.priority : def.priority,
      })
      drew = true
    }
    if (!drew && debug) out.push(marker(config.type, "border", config.type, seen))
  }
  return out
}

/** What a silent segment looks like while `debug` is on. */
function marker(text: string, tone: Tone, type: string, seen: Map<string, number>): Segment {
  const count = (seen.get(type) ?? 0) + 1
  seen.set(type, count)
  return {
    id: count === 1 ? type : `${type}#${count}`,
    runs: [{ text: `⟨${text}⟩`, tone, dim: true }],
    // Above everything, so the thing you are debugging is not the first dropped when it is narrow.
    priority: 100,
  }
}

const TONES = new Set<Tone>(["text", "muted", "accent", "success", "warning", "error", "info"])

function toTone(value: string): Tone | undefined {
  return TONES.has(value as Tone) ? (value as Tone) : undefined
}

function isLiteralColor(value: string): boolean {
  return /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(value)
}
