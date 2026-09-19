/**
 * A wide statusline for the full-width line under the prompt.
 *
 * Two rows: what the model is doing on top, what the repository looks like underneath. Width is
 * the one thing this surface has, so it spends it on figures that deserve the room and lets the
 * priority collapse drop the decorations when the terminal narrows.
 *
 *   {
 *     "statusline": {
 *       "modules": ["<this file>"],
 *       "lines": [
 *         { "surface": "bottom", "separator": " │ ",
 *           "segments": ["model", "capacity", "cost", "session.time", "trend"] },
 *         { "surface": "bottom", "separator": " │ ",
 *           "segments": ["git.branch", "git.diff", "cwd", "diagnostics"] }
 *       ]
 *     }
 *   }
 *
 * Two lines on the same surface stack, which is how a two-row statusline is written.
 */

import type { CustomModule, Run, StatusContext } from "@opencode-cockpit/status/segment"
import { contextRatio, gradient } from "@opencode-cockpit/status/segment"

/** Samples kept between ticks, so `trend` can say which way the session is going. */
const history: { at: number; cost: number }[] = []

export default {
  segments: {
    /**
     * A capacity bar with room for a real scale: ticks every quarter, so the bar can be read
     * against something rather than eyeballed.
     */
    capacity(ctx: StatusContext, config) {
      const ratio = contextRatio(ctx.session)
      if (ratio === undefined) return undefined
      const width = typeof config.width === "number" ? config.width : 20
      const filled = Math.round(ratio * width)
      const runs: Run[] = [{ text: "▕", tone: "border" }]
      for (let cell = 0; cell < width; cell++) {
        if (cell < filled) {
          runs.push({ text: "█", color: gradient((cell + 1) / width) })
        } else {
          // A quarter tick every 25%, so the empty half of the bar still carries a scale.
          const tick = cell > 0 && Math.abs(((cell + 1) / width) % 0.25) < 1 / width
          runs.push({ text: tick ? "┊" : "░", tone: "border" })
        }
      }
      runs.push({ text: "▏", tone: "border" })
      runs.push({ text: ` ${Math.round(ratio * 100)}%`, color: gradient(ratio), bold: ratio >= 0.85 })
      return { runs }
    },

    /** Which way spend is going, from what this module has watched rather than one reading. */
    trend(ctx: StatusContext) {
      const session = ctx.session
      if (!session?.priced) return undefined
      const last = history[history.length - 1]
      if (!last || ctx.now - last.at >= 1000) history.push({ at: ctx.now, cost: session.cost })
      if (history.length > 30) history.shift()

      const first = history[0]
      const latest = history[history.length - 1]
      if (!first || !latest || latest.at === first.at || latest.cost <= 0) return undefined
      const perMinute = ((latest.cost - first.cost) / (latest.at - first.at)) * 60_000
      if (perMinute < 0.005) return undefined
      return {
        runs: [
          { text: perMinute > 0.5 ? "▲" : "▸", tone: perMinute > 0.5 ? "warning" : "muted" },
          { text: ` $${perMinute.toFixed(2)}/min`, tone: "muted" },
        ],
      }
    },
  },
} satisfies CustomModule
