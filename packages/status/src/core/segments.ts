import type { SegmentConfig } from "./config.ts"
import { contextRatio, contextUsed, type StatusContext, todoRemaining, unhealthy } from "./context.ts"
import { bar, compact, duration, money, percent, shortModel, shortPath, truncateStart } from "./format.ts"

/**
 * A drawn piece of the line. `tone` names a theme colour rather than a literal, so the line
 * belongs to whatever theme the user runs.
 */
export type Tone = "text" | "muted" | "accent" | "success" | "warning" | "error" | "info"

export interface Segment {
  id: string
  text: string
  tone: Tone
  /** A literal `#rrggbb` from the config, which wins over `tone` when present. */
  color?: string
  /** Higher survives when the line is too long for the terminal. */
  priority: number
}

/**
 * A built-in. Returning `undefined` hides it, and that is the important half of the contract:
 * a segment whose input is missing must say nothing. A cost of "$0.00" on a provider nobody
 * declared prices for reads as "this was free", which is worse than an absent segment.
 */
export interface SegmentDef {
  name: string
  /** Used when the config does not override it. */
  priority: number
  render(ctx: StatusContext, config: SegmentConfig): Omit<Segment, "id" | "priority"> | undefined
}

const num = (config: SegmentConfig, key: string, fallback: number): number => {
  const value = config[key]
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

const str = (config: SegmentConfig, key: string): string | undefined => {
  const value = config[key]
  return typeof value === "string" ? value : undefined
}

export const BUILTINS: SegmentDef[] = [
  {
    name: "cwd",
    priority: 80,
    render(ctx, config) {
      // A directory outside both the worktree and home has no short form, and an absolute path can
      // be longer than the terminal. Keep the tail: the end of a path is the part that identifies it.
      const text = truncateStart(
        shortPath(ctx.directory, ctx.worktree, ctx.home),
        num(config, "maxWidth", 28),
      )
      return text ? { text, tone: "accent" } : undefined
    },
  },
  {
    name: "git.branch",
    priority: 70,
    render(ctx) {
      if (!ctx.branch) return undefined
      // The default branch is the boring answer; a feature branch is the one worth noticing.
      const onDefault = ctx.defaultBranch !== undefined && ctx.branch === ctx.defaultBranch
      return { text: ctx.branch, tone: onDefault ? "muted" : "info" }
    },
  },
  {
    name: "git.diff",
    priority: 50,
    render(ctx) {
      const diff = ctx.session?.diff
      if (!diff || (diff.additions === 0 && diff.deletions === 0)) return undefined
      return { text: `+${compact(diff.additions)}/-${compact(diff.deletions)}`, tone: "muted" }
    },
  },
  {
    name: "model",
    priority: 60,
    render(ctx, config) {
      const model = ctx.session?.model
      if (!model) return undefined
      const text = config.full === true ? model.modelID : shortModel(model.modelID)
      return { text, tone: "muted" }
    },
  },
  {
    name: "context",
    priority: 85,
    render(ctx, config) {
      const ratio = contextRatio(ctx.session)
      // No declared context window (a proxy, a custom provider) means no denominator. Say nothing
      // rather than invent one.
      if (ratio === undefined) return undefined
      const warnAt = num(config, "warnAt", 0.75)
      const dangerAt = num(config, "dangerAt", 0.9)
      const tone: Tone = ratio >= dangerAt ? "error" : ratio >= warnAt ? "warning" : "muted"
      if (str(config, "style") === "bar") {
        const width = num(config, "width", 8)
        return { text: `[${bar(ratio, width)}] ${percent(ratio)}`, tone }
      }
      return { text: `${percent(ratio)} ctx`, tone }
    },
  },
  {
    name: "tokens",
    priority: 30,
    render(ctx) {
      const used = contextUsed(ctx.session?.tokens)
      return used > 0 ? { text: `${compact(used)} tok`, tone: "muted" } : undefined
    },
  },
  {
    name: "cost",
    priority: 65,
    render(ctx, config) {
      const session = ctx.session
      // Unpriced is not the same as free: hide rather than claim a number nobody configured.
      if (!session?.priced) return undefined
      if (session.cost <= 0 && config.showZero !== true) return undefined
      return { text: money(session.cost, str(config, "currency") ?? "$"), tone: "muted" }
    },
  },
  {
    name: "todo",
    priority: 55,
    render(ctx) {
      const todo = ctx.session?.todo
      if (!todo || todo.total === 0) return undefined
      const left = todoRemaining(ctx.session)
      return {
        text: `${todo.completed}/${todo.total} todo`,
        tone: left === 0 ? "success" : "muted",
      }
    },
  },
  {
    name: "session.status",
    priority: 95,
    render(ctx) {
      const session = ctx.session
      if (!session) return undefined
      if (session.status === "retry") {
        // Retries are invisible in OpenCode today; a stuck session looks identical to a slow one.
        const retry = session.retry
        const wait = retry ? duration(Math.max(0, retry.next - ctx.now)) : ""
        return {
          text: `retry ${retry?.attempt ?? 1}${wait ? ` in ${wait}` : ""}`,
          tone: "warning",
        }
      }
      if (session.status === "busy") {
        const started = session.startedAt
        return { text: started ? `working ${duration(ctx.now - started)}` : "working", tone: "info" }
      }
      return undefined // idle is the normal state; saying so every frame is noise
    },
  },
  {
    name: "session.time",
    priority: 20,
    render(ctx) {
      const started = ctx.session?.startedAt
      return started ? { text: duration(ctx.now - started), tone: "muted" } : undefined
    },
  },
  {
    name: "diagnostics",
    priority: 90,
    render(ctx) {
      // Silent while everything is healthy: a statusline that always shows "LSP ✓" has spent a
      // column to tell you nothing.
      const broken = [...unhealthy(ctx.lsp), ...unhealthy(ctx.mcp)]
      if (broken.length === 0) return undefined
      const names = broken
        .slice(0, 2)
        .map((item) => item.name)
        .join(", ")
      const more = broken.length > 2 ? ` +${broken.length - 2}` : ""
      return { text: `⚠ ${names}${more}`, tone: "error" }
    },
  },
  {
    name: "version",
    priority: 10,
    render(ctx) {
      return ctx.version ? { text: `v${ctx.version}`, tone: "muted" } : undefined
    },
  },
  {
    name: "text",
    priority: 40,
    render(_ctx, config) {
      const value = str(config, "value")
      return value ? { text: value, tone: "muted" } : undefined
    },
  },
  {
    name: "command",
    priority: 45,
    render(ctx, config) {
      const name = str(config, "name") ?? "default"
      const text = ctx.commands[name]
      return text ? { text, tone: "muted" } : undefined
    },
  },
]

const BY_NAME = new Map(BUILTINS.map((def) => [def.name, def]))

export function findSegment(type: string): SegmentDef | undefined {
  return BY_NAME.get(type)
}

/**
 * Builds the line's segments in order, dropping the ones with nothing to say. An unknown type is
 * dropped too rather than drawn as an error: a stale config should cost you a segment, not a line.
 */
export function buildSegments(ctx: StatusContext, configs: SegmentConfig[]): Segment[] {
  const out: Segment[] = []
  const seen = new Map<string, number>()
  for (const config of configs) {
    const def = findSegment(config.type)
    if (!def) continue
    const piece = def.render(ctx, config)
    if (!piece || piece.text.length === 0) continue
    const count = (seen.get(config.type) ?? 0) + 1
    seen.set(config.type, count)
    const prefix = typeof config.prefix === "string" ? config.prefix : ""
    const suffix = typeof config.suffix === "string" ? config.suffix : ""
    const wanted = typeof config.color === "string" ? config.color : undefined
    out.push({
      id: count === 1 ? config.type : `${config.type}#${count}`,
      text: `${prefix}${piece.text}${suffix}`,
      tone: (wanted ? toTone(wanted) : undefined) ?? piece.tone,
      ...(wanted && isLiteralColor(wanted) ? { color: wanted } : {}),
      priority: typeof config.priority === "number" ? config.priority : def.priority,
    })
  }
  return out
}

const TONES = new Set<Tone>(["text", "muted", "accent", "success", "warning", "error", "info"])

function toTone(value: string): Tone | undefined {
  return TONES.has(value as Tone) ? (value as Tone) : undefined
}

function isLiteralColor(value: string): boolean {
  return /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(value)
}
