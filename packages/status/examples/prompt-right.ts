/**
 * A compact statusline for the right-hand side of the prompt box.
 *
 * This surface gets about a third of the window and sits where your eye already is while you type,
 * so it carries the two or three things worth interrupting you for and nothing else. Every segment
 * here is built to stay legible at ten cells.
 *
 *   {
 *     "statusline": {
 *       "modules": ["<this file>"],
 *       "surface": "promptRight",
 *       "segments": ["state", "meter", "attention"]
 *     }
 *   }
 */

import type { CustomModule, Run, StatusContext } from "@opencode-cockpit/status/segment"
import { contextRatio, gradient, unhealthy } from "@opencode-cockpit/status/segment"

/** Eighths, so a ten-cell meter still resolves eighty steps. */
const EIGHTHS = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"]

export default {
  segments: {
    /**
     * The session's state as a filled pill. A word in grey is easy to miss while you are typing;
     * a block of colour is not, which is the whole job of this surface.
     */
    state(ctx: StatusContext) {
      const session = ctx.session
      if (!session || session.status === "idle") return undefined
      const [label, tone] =
        session.status === "retry"
          ? [`RETRY ${session.retry?.attempt ?? 1}`, "warning" as const]
          : ["WORKING", "info" as const]
      return {
        runs: [
          { text: "▐", tone },
          { text: ` ${label} `, tone: "background" as const, bgTone: tone, bold: true },
          { text: "▌", tone },
        ],
      }
    },

    /** A context meter that stays readable when it only has six cells to work with. */
    meter(ctx: StatusContext, config) {
      const ratio = contextRatio(ctx.session)
      if (ratio === undefined) return undefined
      const width = typeof config.width === "number" ? config.width : 6
      const exact = ratio * width
      const full = Math.floor(exact)
      const runs: Run[] = []
      for (let cell = 0; cell < width; cell++) {
        if (cell < full) runs.push({ text: "█", color: gradient((cell + 1) / width) })
        else if (cell === full) {
          // The partial cell is what keeps a short bar honest: without it a six-cell meter
          // reports in jumps of seventeen per cent.
          const part = EIGHTHS[Math.floor((exact - full) * 8)] ?? ""
          runs.push(
            part ? { text: part, color: gradient((cell + 1) / width) } : { text: "·", tone: "border" },
          )
        } else runs.push({ text: "·", tone: "border" })
      }
      runs.push({ text: ` ${Math.round(ratio * 100)}%`, color: gradient(ratio) })
      return { runs }
    },

    /**
     * The one segment that earns its place by being empty: it says nothing until something needs
     * you -- a question waiting, a service down, the context nearly full.
     */
    attention(ctx: StatusContext) {
      const ratio = contextRatio(ctx.session) ?? 0
      const broken = [...unhealthy(ctx.lsp), ...unhealthy(ctx.mcp)]
      if (ratio >= 0.9) {
        return { runs: [{ text: "◉ context nearly full", tone: "error" as const, bold: true }] }
      }
      if (broken.length > 0) {
        return {
          runs: [
            { text: "◉ ", tone: "warning" as const },
            { text: broken[0]?.name ?? "service", tone: "warning" as const },
          ],
        }
      }
      return undefined
    },
  },
} satisfies CustomModule
