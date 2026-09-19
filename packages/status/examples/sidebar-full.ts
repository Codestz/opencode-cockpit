/**
 * The sidebar as the whole instrument panel, for people who would rather not read a line under
 * the prompt at all.
 *
 * This one is meant to *replace* OpenCode's own Context block rather than sit beside it, so it
 * carries the figures that block carried — tokens, percentage, spend — and then the ones it never
 * did. Turn the host's block off and give the column to this:
 *
 *   // ~/.config/opencode/tui.json
 *   { "plugin": ["opencode-cockpit"], "plugin_enabled": { "internal:sidebar-context": false } }
 *
 *   // ~/.config/opencode-cockpit/config.json
 *   {
 *     "statusline": {
 *       "modules": ["<this file>"],
 *       "surface": "sidebar",
 *       "segments": [
 *         { "type": "text", "value": "CONTEXT", "color": "border" },
 *         "gauge", "window", "cache",
 *         { "type": "text", "value": "SPEND", "color": "border" },
 *         "spend",
 *         { "type": "text", "value": "SESSION", "color": "border" },
 *         "elapsed", "work", "tasks"
 *       ],
 *       "maxRows": 14
 *     }
 *   }
 *
 * Every row is self-labelled and built to read at about thirty characters, and there are
 * deliberately no section headings: a heading cannot know whether the rows under it will draw
 * anything, so on an unpriced model a "SPEND" title strands itself above nothing.
 *
 * `tasks` is here but left out of the config above, because OpenCode's own Todo list carries the
 * task names and this is only a count. Add it if you switch that list off too
 * (`internal:sidebar-todo`).
 */

import type { CustomModule, Run, StatusContext } from "@opencode-cockpit/status/segment"
import {
  compact,
  contextRatio,
  contextUsed,
  gradient,
  money,
  preciseDuration,
} from "@opencode-cockpit/status/segment"

/** Spend samples, so a rate can be shown beside the total. */
const samples: { at: number; cost: number }[] = []

/** A row of label and value, so a column of them lines up as a table would. */
function row(label: string, value: Run[]): { runs: Run[] } {
  return { runs: [{ text: `${label} `, tone: "muted", dim: true }, ...value] }
}

export default {
  segments: {
    /** The headline figure, and the one the host's block led with. */
    bar(ctx: StatusContext, config) {
      const ratio = contextRatio(ctx.session)
      if (ratio === undefined) return undefined
      const width = typeof config.width === "number" ? config.width : 16
      const filled = Math.round(ratio * width)
      const runs: Run[] = []
      for (let cell = 0; cell < width; cell++) {
        runs.push(
          cell < filled
            ? { text: "█", color: gradient((cell + 1) / width) }
            : { text: "░", tone: "border" as const },
        )
      }
      runs.push({
        text: ` ${Math.round(ratio * 100)}%`,
        color: gradient(ratio),
        bold: ratio >= 0.85,
      })
      return { runs }
    },

    /** What the percentage is a percentage of — the denominator the bar hides. */
    window(ctx: StatusContext) {
      const used = contextUsed(ctx.session?.tokens)
      const limit = ctx.session?.model?.contextLimit
      if (used === 0) return undefined
      return limit
        ? row("of", [
            { text: compact(used), tone: "text" },
            { text: ` / ${compact(limit)}`, tone: "muted" },
          ])
        : row("used", [{ text: `${compact(used)} tok`, tone: "text" }])
    },

    /**
     * What was replayed from cache against what had to be sent fresh — the two figures side by
     * side rather than a share of them. A share reads as "100%" for most of a cached session,
     * which looks like a bug even when it is arithmetic.
     */
    cached(ctx: StatusContext) {
      const tokens = ctx.session?.tokens
      if (!tokens || contextUsed(tokens) === 0) return undefined
      const fresh = tokens.input + tokens.output + tokens.reasoning
      return row("cache", [
        { text: compact(tokens.cache.read), tone: "success" },
        { text: " · fresh ", tone: "muted", dim: true },
        { text: compact(fresh), tone: "info" },
      ])
    },

    /** What the session has cost, and what it is costing. Silent where nobody declared prices. */
    spend(ctx: StatusContext) {
      const session = ctx.session
      if (!session?.priced) return undefined
      const last = samples[samples.length - 1]
      if (!last || ctx.now - last.at >= 1000) samples.push({ at: ctx.now, cost: session.cost })
      if (samples.length > 60) samples.shift()

      const first = samples[0]
      const latest = samples[samples.length - 1]
      const runs: Run[] = [{ text: money(session.cost), tone: "warning" }]
      if (first && latest && latest.at > first.at) {
        const perMinute = ((latest.cost - first.cost) / (latest.at - first.at)) * 60_000
        if (perMinute >= 0.005) {
          runs.push({ text: ` · $${perMinute.toFixed(2)}/min`, tone: "muted", dim: true })
        }
      }
      return { runs }
    },

    /** How long this has been going, in a unit a person reads without converting. */
    elapsed(ctx: StatusContext) {
      const started = ctx.session?.startedAt
      if (started === undefined) return undefined
      return row("for", [{ text: preciseDuration(ctx.now - started), tone: "muted" }])
    },

    /** What the session has done to the tree. */
    changes(ctx: StatusContext) {
      const diff = ctx.session?.diff
      if (!diff || diff.files === 0) return undefined
      return row("diff", [
        { text: `+${compact(diff.additions)}`, tone: "success" },
        { text: ` -${compact(diff.deletions)}`, tone: "error" },
        { text: ` · ${diff.files}f`, tone: "muted", dim: true },
      ])
    },

    /**
     * Work outstanding, for a sidebar where OpenCode's own Todo list is switched off. With that
     * list on, this is a worse copy of it — the list carries the task names.
     */
    todo(ctx: StatusContext) {
      const todo = ctx.session?.todo
      if (!todo || todo.total === 0 || todo.completed === todo.total) return undefined
      return row("todo", [
        { text: `${todo.completed}/${todo.total}`, tone: "text" },
        { text: ` · ${todo.total - todo.completed} left`, tone: "muted", dim: true },
      ])
    },
  },
} satisfies CustomModule
