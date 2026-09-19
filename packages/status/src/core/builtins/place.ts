/** Where you are: the folder, the branch, and what has changed in it. */

import { compact, shortPath, truncateStart } from "../format.ts"
import type { SegmentDef } from "../types.ts"
import { num } from "./settings.ts"

export const SEGMENTS: SegmentDef[] = [
  {
    name: "cwd",
    icon: "▸",
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
    icon: "⑂",
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
    icon: "±",
    priority: 50,
    render(ctx) {
      const diff = ctx.session?.diff
      if (!diff || (diff.additions === 0 && diff.deletions === 0)) return undefined
      // Two colours: what was added and what was taken away are read separately.
      return {
        runs: [
          { text: `+${compact(diff.additions)}`, tone: "success" },
          { text: " / ", tone: "muted", dim: true },
          { text: `-${compact(diff.deletions)}`, tone: "error" },
        ],
      }
    },
  },
]
