/**
 * Everything on one line, for a window with no sidebar open.
 *
 * Every segment here reads the session snapshot, which is the line this bay draws: anything a CLI
 * can already print belongs in a `command`, shaped in the shell, not in a segment that duplicates
 * it. The working tree, for instance, needs no code from us at all:
 *
 *   "commands": { "tree": { "run": "git diff --shortstat | awk '{print \"+\"$4\" -\"$6}'" } }
 *
 * This is the whole statusline for someone who lives in the bottom line: how full the context is,
 * which way it is going, what the session has changed, and whether anything needs them. It is the
 * densest of the examples on purpose -- the bottom line is the only surface with real width.
 *
 *   {
 *     "statusline": {
 *       "modules": ["<this file>"],
 *       "lines": [
 *         { "surface": "bottom", "separator": " │ ",
 *           "segments": ["bar", "filling", "rate", "cached", "session.diff", "todo",
 *                        "session.time", "diagnostics"] }
 *       ]
 *     }
 *   }
 *
 * Two lines on the same surface stack, if you would rather split it in two rows.
 */

import type { CustomModule, Run, StatusContext } from "@opencode-cockpit/status/segment"
import { compact, contextRatio, contextUsed, gradient } from "@opencode-cockpit/status/segment"

/** Samples kept between ticks: the shape of a session is not visible in any single reading. */
const samples: { at: number; ratio: number; cost: number }[] = []

function sample(ctx: StatusContext): void {
  const last = samples[samples.length - 1]
  if (last && ctx.now - last.at < 1000) return
  samples.push({
    at: ctx.now,
    ratio: contextRatio(ctx.session) ?? 0,
    cost: ctx.session?.cost ?? 0,
  })
  if (samples.length > 30) samples.shift()
}

export default {
  segments: {
    /**
     * The context window as a bar with a scale: every cell carries the colour of the level it
     * stands for, and a quarter tick marks the empty half so the bar can be read against
     * something rather than eyeballed.
     */
    bar(ctx: StatusContext, config) {
      const ratio = contextRatio(ctx.session)
      if (ratio === undefined) return undefined
      const width = typeof config.width === "number" ? config.width : 20
      const filled = Math.round(ratio * width)
      const runs: Run[] = [{ text: "▕", tone: "border" }]
      for (let cell = 0; cell < width; cell++) {
        if (cell < filled) {
          runs.push({ text: "█", color: gradient((cell + 1) / width) })
        } else {
          const tick = cell > 0 && Math.abs(((cell + 1) / width) % 0.25) < 1 / width
          runs.push({ text: tick ? "┊" : "░", tone: "border" })
        }
      }
      runs.push({ text: "▏", tone: "border" })
      runs.push({
        text: ` ${Math.round(ratio * 100)}%`,
        color: gradient(ratio),
        bold: ratio >= 0.85,
      })
      return { runs }
    },

    /**
     * How fast the window is filling, as a figure rather than a picture.
     *
     * This was a sparkline. A sparkline redraws its whole shape every second, and a shape moving
     * in the corner of your eye pulls attention away from what you are reading -- which is the one
     * thing a statusline must not do. The same information as a rate changes its digits and
     * nothing else.
     */
    filling(ctx: StatusContext) {
      sample(ctx)
      const seen = samples.filter((entry) => entry.ratio > 0)
      const first = seen[0]
      const last = seen[seen.length - 1]
      if (!first || !last || last.at === first.at) return undefined
      const perMinute = ((last.ratio - first.ratio) / (last.at - first.at)) * 60_000 * 100
      if (Math.abs(perMinute) < 0.05) return undefined
      // Minutes left at this rate is the figure worth knowing; the rate itself is the input.
      const headroom = (1 - last.ratio) * 100
      const minutesLeft = perMinute > 0 ? headroom / perMinute : Number.POSITIVE_INFINITY
      return {
        runs: [
          { text: `+${perMinute.toFixed(1)}%/min`, tone: "muted" as const },
          ...(Number.isFinite(minutesLeft) && minutesLeft < 90
            ? [
                {
                  text: ` · ${Math.round(minutesLeft)}m left`,
                  tone: minutesLeft < 15 ? ("warning" as const) : ("muted" as const),
                },
              ]
            : []),
        ],
      }
    },

    /** Spend per minute with a direction. Silent where nobody declared prices. */
    rate(ctx: StatusContext) {
      sample(ctx)
      const session = ctx.session
      if (!session?.priced || session.cost <= 0) return undefined
      const first = samples[0]
      const last = samples[samples.length - 1]
      if (!first || !last || last.at === first.at) return undefined
      const perMinute = ((last.cost - first.cost) / (last.at - first.at)) * 60_000
      if (perMinute < 0.005) return undefined
      return {
        runs: [
          { text: perMinute > 0.5 ? "▲" : "▸", tone: perMinute > 0.5 ? "warning" : "muted" },
          { text: ` $${perMinute.toFixed(2)}/min`, tone: "muted" },
        ],
      }
    },

    /**
     * How much of the window is cache rather than fresh input. High is cheap and fast; low means
     * the session keeps re-sending what it already sent.
     */
    cached(ctx: StatusContext) {
      const tokens = ctx.session?.tokens
      const total = contextUsed(tokens)
      if (!tokens || total === 0) return undefined
      const share = tokens.cache.read / total
      return {
        runs: [
          { text: "▌", tone: share > 0.5 ? "success" : "muted" },
          { text: `${Math.round(share * 100)}% cached`, tone: "muted" },
        ],
      }
    },

    /** The session's own size, for when a window has quietly filled up with one long turn. */
    tokens(ctx: StatusContext) {
      const used = contextUsed(ctx.session?.tokens)
      return used > 0 ? { text: `${compact(used)} tok`, tone: "muted" as const } : undefined
    },
  },
} satisfies CustomModule
