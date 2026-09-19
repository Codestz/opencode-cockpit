/** Where you are: the folder, the branch, and what has changed in it. */

import { compact, shortPath, truncateStart } from "../format.ts"
import type { SegmentDef } from "../types.ts"
import { formatted, num } from "./settings.ts"

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
    /**
     * What *this session* changed, which is what OpenCode's own Files list shows -- not what `git
     * status` would. A file you edited by hand was never part of the session and does not appear
     * here, which is why the old name, `git.diff`, was a trap. That name still works.
     *
     * For the working tree, use a command segment: `git diff --shortstat`.
     */
    name: "session.diff",
    icon: "±",
    priority: 50,
    render(ctx, config) {
      const diff = ctx.session?.diff
      if (!diff || (diff.additions === 0 && diff.deletions === 0)) return undefined
      const shaped = formatted(config, {
        files: diff.files,
        added: diff.additions,
        removed: diff.deletions,
      })
      if (shaped) return shaped
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
