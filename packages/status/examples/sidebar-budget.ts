/**
 * A sidebar built as a table: a context header, the window as one solid bar, the tokens broken
 * into named rows, a budget read from a proxy, and the branch's whole diff.
 *
 * This is the layout a user arrived at after five rejected iterations, kept here because the
 * reasons are worth more than the rows: every number gets a word, the labels are a fixed column
 * so the values line up, the bar is solid rather than dashed, and the groups are separated by
 * hairlines rather than headings — a heading cannot know whether the rows under it will draw.
 *
 *   {
 *     "statusline": {
 *       "modules": ["<this file>"],
 *       "lines": [{
 *         "surface": "sidebar",
 *         "maxRows": 13,
 *         "segments": ["title", "bar", "tokens", "in", "out", "cache", "write",
 *                      "sep", "spend", "avail", "sep", "git"]
 *       }]
 *     }
 *   }
 *
 * It replaces OpenCode's own Context block, so turn that off:
 *   { "plugin_enabled": { "internal:sidebar-context": false } }
 *
 * The budget rows read a file a proxy writes. Without one they stay silent, which is right in a
 * statusline and unhelpful while you are designing — `"demo": true` on either segment fills in
 * sample figures so the layout can be looked at.
 */

import { execFile } from "node:child_process"
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { CustomModule, Piece, Run, SegmentConfig, StatusContext } from "@opencode-cockpit/status/segment"
import { compact, contextRatio, contextUsed, gradient } from "@opencode-cockpit/status/segment"

/** The label column, padded so every value starts in the same place. */
const LABEL = 6
function row(label: string, value: Run[]): { runs: Run[] } {
  return { runs: [{ text: label.padEnd(LABEL), tone: "muted", dim: true }, ...value] }
}

/** A marker in a category colour, so the label and the colour say the same thing twice. */
function mark(tone: "success" | "info" | "text" | "warning"): Run {
  return { text: "▪ ", tone }
}

const BAR = 16

/** What each token row needs: its own figure, and its share of the window. */
function share(ctx: StatusContext, value: number, tone: "success" | "info" | "text" | "warning") {
  const total = contextUsed(ctx.session?.tokens)
  if (total === 0) return undefined
  return [
    mark(tone),
    { text: compact(value), tone: "muted" as const },
    { text: ` · ${Math.round((value / total) * 100)}%`, tone: "muted" as const, dim: true },
  ]
}

/**
 * The spend a proxy reports. LiteLLM's IAP plugin writes this; anything that writes
 * `{ baseline, delta, cap }` will do. Re-read at most every five seconds — the file is tiny, but
 * a statusline redraws every second and this is not worth a syscall each time.
 */
interface Spend {
  baseline?: number
  delta?: number
  cap?: number
}
let cached: { at: number; spend: Spend | undefined } | undefined
function spendState(config: SegmentConfig): { total: number; cap: number } | undefined {
  if (config.demo === true) return { total: 26.24, cap: 200 }
  const now = Date.now()
  if (!cached || now - cached.at > 5000) {
    const file =
      typeof config.file === "string"
        ? config.file
        : join(homedir(), ".cache", "opencode-litellm-iap", "spend.json")
    try {
      cached = { at: now, spend: JSON.parse(readFileSync(file, "utf8")) as Spend }
    } catch {
      cached = { at: now, spend: undefined }
    }
  }
  const { baseline, delta, cap } = cached.spend ?? {}
  if (typeof baseline !== "number" || typeof cap !== "number" || cap <= 0) return undefined
  return { total: baseline + (typeof delta === "number" ? delta : 0), cap }
}

/** Green with room, amber as it tightens, red when it is nearly gone. */
function budgetColour(left: number): string {
  return left >= 0.5 ? "#39d353" : left >= 0.2 ? "#e8b923" : "#f85149"
}

/**
 * The branch's whole diff against where it forked: every commit on the branch plus uncommitted
 * edits — what a reviewer would read, rather than what this session happened to touch. Git runs
 * away from the draw path and the row shows whatever the last finished reading produced.
 */
interface BranchDiff {
  files: number
  added: number
  removed: number
}
let branch: BranchDiff | undefined
let asking = false
let askedAt = 0
function refreshBranch(ctx: StatusContext): void {
  if (asking || Date.now() - askedAt < 10_000) return
  asking = true
  const base = ctx.defaultBranch ?? "main"
  const run = execFile as unknown as (
    cmd: string,
    args: string[],
    opts: { timeout: number; cwd: string },
    cb: (err: Error | null, out: string) => void,
  ) => void
  const opts = { timeout: 3000, cwd: ctx.worktree }
  run("git", ["merge-base", base, "HEAD"], opts, (err, fork) => {
    if (err || !fork.trim()) {
      asking = false
      askedAt = Date.now()
      return
    }
    run("git", ["diff", "--shortstat", fork.trim()], opts, (err2, out) => {
      asking = false
      askedAt = Date.now()
      if (err2) return
      const found = /(\d+) files? changed(?:, (\d+) insertions?)?(?:, (\d+) deletions?)?/.exec(out)
      if (!found) return
      branch = {
        files: Number(found[1]),
        added: Number(found[2] ?? 0),
        removed: Number(found[3] ?? 0),
      }
    })
  })
}

export default {
  segments: {
    /** The column's subject, so the table below it has one. */
    title() {
      return { runs: [{ text: "Context", tone: "text", bold: true }] }
    },

    /**
     * One solid bar: filled cells coloured by level, empty cells a solid dark track. Not `░`,
     * which reads as floating gaps, and not `─`, which reads as a row of dashes.
     *
     * No end caps. `▕` and `▏` are eighth-blocks whose ink sits against one edge of the cell, so an
     * opening cap indents the row by most of a column and the bar stops lining up with the labels
     * above and below it. The dark track already shows how far the bar could go.
     *
     * No figure beside it either: the `tokens` row directly below already reads the percentage out,
     * and a number printed twice in a column of ten rows is the thing the eye catches on.
     */
    bar(ctx: StatusContext) {
      const ratio = contextRatio(ctx.session)
      if (ratio === undefined) return undefined
      const filled = Math.round(ratio * BAR)
      const runs: Run[] = Array.from({ length: BAR }, (_, cell) =>
        cell < filled
          ? { text: "█", color: gradient((cell + 1) / BAR) }
          : { text: "█", tone: "border" as const },
      )
      return { runs }
    },

    /** The whole window, and how full it is. */
    tokens(ctx: StatusContext) {
      const total = contextUsed(ctx.session?.tokens)
      if (total === 0) return undefined
      const ratio = contextRatio(ctx.session)
      return row("tokens", [
        { text: compact(total), tone: "text" },
        ...(ratio === undefined ? [] : [{ text: ` · ${Math.round(ratio * 100)}%`, color: gradient(ratio) }]),
      ])
    },

    /** Fresh prompt tokens: neither cached nor generated. */
    in(ctx: StatusContext) {
      const value = share(ctx, ctx.session?.tokens?.input ?? 0, "info")
      return value && row("in", value)
    },

    /** What the model wrote, reasoning included. */
    out(ctx: StatusContext) {
      const tokens = ctx.session?.tokens
      const value = share(ctx, (tokens?.output ?? 0) + (tokens?.reasoning ?? 0), "text")
      return value && row("out", value)
    },

    /** Served from the prompt cache — cheap, and usually most of the window. */
    cache(ctx: StatusContext) {
      const value = share(ctx, ctx.session?.tokens?.cache.read ?? 0, "success")
      return value && row("cache", value)
    },

    /** Written into the cache this session — a one-time premium each. Not the same as "out". */
    write(ctx: StatusContext) {
      const value = share(ctx, ctx.session?.tokens?.cache.write ?? 0, "warning")
      return value && row("write", value)
    },

    /** A hairline, to group without a heading that might strand itself. */
    sep() {
      return { runs: [{ text: "─".repeat(14), tone: "border", dim: true }] }
    },

    /** Spent so far against the cap. */
    spend(_ctx: StatusContext, config: SegmentConfig) {
      const state = spendState(config)
      if (!state) return undefined
      const colour = budgetColour(Math.max(0, state.cap - state.total) / state.cap)
      return row("spend", [
        { text: "▪ ", color: colour },
        { text: `$${state.total.toFixed(2)}`, color: colour, bold: true },
      ])
    },

    /** What is left, and the share of the cap that decides the colour. */
    avail(_ctx: StatusContext, config: SegmentConfig) {
      const state = spendState(config)
      if (!state) return undefined
      const left = Math.max(0, state.cap - state.total)
      const ratio = left / state.cap
      const colour = budgetColour(ratio)
      return row("avail", [
        { text: "▪ ", color: colour },
        { text: `$${left.toFixed(2)}`, color: colour, bold: true },
        { text: ` · ${Math.round(ratio * 100)}%`, color: colour },
      ])
    },

    /** The branch as a reviewer will see it, not as this session left it. */
    git(ctx: StatusContext, config: SegmentConfig): Piece | undefined {
      if (config.demo === true) {
        return row("git", [
          { text: "3f", tone: "muted" },
          { text: " +42", tone: "success" },
          { text: " -7", tone: "error" },
          { text: ` vs ${ctx.defaultBranch ?? "main"}`, tone: "muted", dim: true },
        ])
      }
      refreshBranch(ctx)
      if (!branch || branch.files === 0) return undefined
      return row("git", [
        { text: `${branch.files}f`, tone: "muted" },
        { text: ` +${compact(branch.added)}`, tone: "success" },
        { text: ` -${compact(branch.removed)}`, tone: "error" },
        { text: ` vs ${ctx.defaultBranch ?? "main"}`, tone: "muted", dim: true },
      ])
    },
  },
} satisfies CustomModule
