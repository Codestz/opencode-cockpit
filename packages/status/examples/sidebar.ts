/**
 * A small, quiet sidebar: a coloured context bar and the two figures behind it.
 *
 * The sidebar sits beside OpenCode's own Context block, which already gives you the token count,
 * the percentage and the spend. So this one does not repeat them -- it draws the bar those numbers
 * describe, and adds the two things the host leaves out: how the window is being used, and what
 * the session has changed.
 *
 *   {
 *     "statusline": {
 *       "modules": ["<this file>"],
 *       "surface": "sidebar",
 *       "segments": ["bar", "split", "changes"]
 *     }
 *   }
 *
 * `stack` defaults to vertical here, so it does not need to be written.
 */

import type { CustomModule, Run, StatusContext } from "@opencode-cockpit/status/segment"
import { compact, contextRatio, contextUsed, gradient } from "@opencode-cockpit/status/segment"

/** A row with a quiet label, so a column of them lines up as a table would. */
function row(label: string, value: Run[]): { runs: Run[] } {
  return { runs: [{ text: `${label} `, tone: "muted", dim: true }, ...value] }
}

export default {
  segments: {
    /**
     * The context window, coloured cell by cell. The figure beside it is the host's own, so this
     * is the one place the bay repeats something -- a bar with no number is hard to read at a
     * glance, and the percentage is two characters.
     */
    bar(ctx: StatusContext, config) {
      const ratio = contextRatio(ctx.session)
      if (ratio === undefined) return undefined
      const width = typeof config.width === "number" ? config.width : 14
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

    /**
     * What the window is made of: cache, fresh input, output. A coloured rule per part rather
     * than a filled chip, so a share of nothing is a mark rather than an empty box.
     */
    split(ctx: StatusContext) {
      const tokens = ctx.session?.tokens
      const total = contextUsed(tokens)
      if (!tokens || total === 0) return undefined
      const share = (n: number) => `${Math.round((n / total) * 100)}%`
      return row("split", [
        { text: "▌", tone: "success" },
        { text: share(tokens.cache.read + tokens.cache.write), tone: "muted" },
        { text: " ▌", tone: "info" },
        { text: share(tokens.input), tone: "muted" },
        { text: " ▌", tone: "accent" },
        { text: share(tokens.output + tokens.reasoning), tone: "muted" },
      ])
    },

    /** What the session has done to the working tree, which the host never mentions. */
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
