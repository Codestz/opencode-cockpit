/**
 * A vertical dashboard for the sidebar.
 *
 * The sidebar is a narrow column with vertical room to spare, which is the opposite trade from
 * every other surface: nothing here has to fit on one line, so each segment gets a labelled row
 * and can say its piece properly.
 *
 *   {
 *     "statusline": {
 *       "modules": ["<this file>"],
 *       "surface": "sidebar",
 *       "segments": ["heading", "window", "composition", "sparkline", "spend", "changes"]
 *     }
 *   }
 *
 * `stack` defaults to vertical on this surface, so it does not need to be written.
 */

import type { CustomModule, Run, StatusContext } from "@opencode-cockpit/status/segment"
import {
  compact,
  contextRatio,
  contextUsed,
  gradient,
  money,
  shortModel,
} from "@opencode-cockpit/status/segment"

const SPARK = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"]
const samples: number[] = []

/** A row with a quiet label and a value, so a column of them lines up as a table would. */
function row(label: string, value: Run[]): { runs: Run[] } {
  return { runs: [{ text: `${label} `, tone: "muted", dim: true }, ...value] }
}

export default {
  segments: {
    /** Which model, stated once at the top rather than repeated in every row. */
    heading(ctx: StatusContext) {
      const model = ctx.session?.model
      if (!model) return undefined
      return {
        runs: [{ text: shortModel(model.modelID), tone: "accent" as const, bold: true }],
      }
    },

    /** How full the window is, as a bar the column is wide enough to draw properly. */
    window(ctx: StatusContext, config) {
      const ratio = contextRatio(ctx.session)
      if (ratio === undefined) return undefined
      const width = typeof config.width === "number" ? config.width : 12
      const filled = Math.round(ratio * width)
      const runs: Run[] = []
      for (let cell = 0; cell < width; cell++) {
        runs.push(
          cell < filled
            ? { text: "█", color: gradient((cell + 1) / width) }
            : { text: "░", tone: "border" as const },
        )
      }
      runs.push({ text: ` ${Math.round(ratio * 100)}%`, color: gradient(ratio) })
      return { runs }
    },

    /** Where the window went. Three labelled rows would be three lines; three chips are one. */
    composition(ctx: StatusContext) {
      const tokens = ctx.session?.tokens
      const total = contextUsed(tokens)
      if (!tokens || total === 0) return undefined
      const share = (n: number) => `${Math.round((n / total) * 100)}%`
      return row("use", [
        { text: ` ${share(tokens.cache.read + tokens.cache.write)} `, tone: "background", bgTone: "success" },
        { text: " " },
        { text: ` ${share(tokens.input)} `, tone: "background", bgTone: "info" },
        { text: " " },
        { text: ` ${share(tokens.output + tokens.reasoning)} `, tone: "background", bgTone: "accent" },
      ])
    },

    /** The shape of the session over time, which no single reading can show. */
    sparkline(ctx: StatusContext) {
      const ratio = contextRatio(ctx.session)
      if (ratio === undefined) return undefined
      samples.push(ratio)
      if (samples.length > 16) samples.shift()
      if (samples.length < 2) return undefined
      return row(
        "over",
        samples.map((value) => ({
          text: SPARK[Math.min(7, Math.floor(value * 8))] as string,
          color: gradient(value),
        })),
      )
    },

    /** Spend, and the tokens behind it. Silent where nobody declared prices. */
    spend(ctx: StatusContext) {
      const session = ctx.session
      if (!session) return undefined
      const used = contextUsed(session.tokens)
      if (!session.priced) {
        // No prices declared: report what is measurable instead of a cost that would be a guess.
        return used > 0 ? row("used", [{ text: `${compact(used)} tokens`, tone: "muted" }]) : undefined
      }
      return row("cost", [
        { text: money(session.cost), tone: "warning" },
        { text: ` · ${compact(used)}`, tone: "muted", dim: true },
      ])
    },

    /** What the session has done to the working tree. */
    changes(ctx: StatusContext) {
      const diff = ctx.session?.diff
      if (!diff || diff.files === 0) return undefined
      return row("diff", [
        { text: `${diff.files}f`, tone: "muted" },
        { text: ` +${compact(diff.additions)}`, tone: "success" },
        { text: ` -${compact(diff.deletions)}`, tone: "error" },
      ])
    },
  },
} satisfies CustomModule
