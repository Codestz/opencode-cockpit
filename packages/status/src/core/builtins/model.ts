/** The model in play, how full its context window is, and what the session is spending. */

import { contextRatio, contextUsed } from "../context.ts"
import { bar, compact, gradient, money, percent, shortModel } from "../format.ts"
import type { Run, SegmentDef, Tone } from "../types.ts"
import { num, str } from "./settings.ts"

export const SEGMENTS: SegmentDef[] = [
  {
    name: "model",
    icon: "◆",
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
    icon: "◔",
    render(ctx, config) {
      const ratio = contextRatio(ctx.session)
      // No declared context window (a proxy, a custom provider) means no denominator. Say nothing
      // rather than invent one.
      if (ratio === undefined) return undefined
      const warnAt = num(config, "warnAt", 0.75)
      const dangerAt = num(config, "dangerAt", 0.9)
      const tone: Tone = ratio >= dangerAt ? "error" : ratio >= warnAt ? "warning" : "muted"
      const style = str(config, "style") ?? "percent"
      const width = num(config, "width", 10)

      if (style === "split") {
        // What is actually in the window, by where it came from: cache reads are the cheap part,
        // fresh input the expensive one, output what the model has added. One bar, three colours,
        // so the shape of the session is readable without a second segment.
        const tokens = ctx.session?.tokens
        if (!tokens) return undefined
        const limit = ctx.session?.model?.contextLimit as number
        const cells = (n: number) => Math.round((n / limit) * width)
        const cached = cells(tokens.cache.read + tokens.cache.write)
        const fresh = cells(tokens.input)
        const out = cells(tokens.output + tokens.reasoning)
        const used = Math.min(width, cached + fresh + out)
        return {
          runs: [
            { text: "▐", tone: "muted", dim: true },
            { text: "█".repeat(cached), tone: "success" },
            { text: "█".repeat(fresh), tone: "info" },
            { text: "█".repeat(out), tone: "accent" },
            { text: "·".repeat(Math.max(0, width - used)), tone: "muted", dim: true },
            { text: "▌", tone: "muted", dim: true },
            { text: ` ${percent(ratio)}`, tone },
          ],
        }
      }

      if (style === "gradient") {
        // Every cell carries the colour of the level it stands for, interpolated rather than
        // bucketed, so the bar reads as a measurement instead of three states.
        const filled = Math.round(ratio * width)
        const runs: Run[] = []
        for (let cell = 0; cell < width; cell++) {
          runs.push(
            cell < filled
              ? { text: "█", color: gradient((cell + 1) / width) }
              : { text: "░", tone: "border" },
          )
        }
        runs.push({ text: ` ${percent(ratio)}`, color: gradient(ratio), bold: ratio >= 0.85 })
        return { runs }
      }

      if (style === "bar") {
        const filled = bar(ratio, width)
        return {
          runs: [
            { text: "▐", tone: "muted", dim: true },
            { text: filled.trimEnd(), tone },
            { text: "·".repeat(filled.length - filled.trimEnd().length), tone: "muted", dim: true },
            { text: "▌", tone: "muted", dim: true },
            { text: ` ${percent(ratio)}`, tone },
          ],
        }
      }
      return { text: `${percent(ratio)} ctx`, tone }
    },
  },
  {
    name: "tokens",
    icon: "⧉",
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
]
