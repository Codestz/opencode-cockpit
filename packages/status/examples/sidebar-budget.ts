/**
 * A sidebar built as a table: a context header, the window as one solid bar, the tokens broken
 * into named rows, a budget read from a proxy, and the branch's whole diff.
 *
 * This is the layout a user arrived at after five rejected iterations, kept here because the
 * reasons are worth more than the rows: every number gets a word, the labels are a fixed column
 * so the values line up, the bar is solid rather than dashed, and the groups are separated by
 * hairlines rather than headings — a heading cannot know whether the rows under it will draw.
 *
 * And, from seeing it on a real session: the word is the label, so there is no coloured square
 * beside it saying the same thing in a colour nobody can decode; a row whose figure is zero is not
 * drawn (`write 0 · 0%` said nothing, at length); and colour is a level — the bar, the percentage
 * and the budget are calm until a threshold, then the warning, then the error — never a category.
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
import { compact, contextRatio, contextUsed, GAUGE, gaugeTone } from "@opencode-cockpit/status/segment"

/**
 * The label column, padded so every value starts in the same place. The word is the label. Seven:
 * the longest label is `tokens`, and at six it ran into its own figure (`tokens167.8k`).
 */
const LABEL = 7
function row(label: string, value: Run[]): { runs: Run[] } {
  return { runs: [{ text: label.padEnd(LABEL), tone: "muted" }, ...value] }
}

const BAR = 16

/**
 * A level's tone: nothing until it is worth a colour, then the gauge rule's warning or error. Calm
 * is left to the bar, so a column of figures is not a column of greens.
 */
const level = (ratio: number): Run["tone"] => (ratio >= GAUGE.warnAt ? gaugeTone(ratio) : "text")

/** What each token row needs: its own figure, and its share of the window. Zero is not a row. */
function share(ctx: StatusContext, value: number) {
  const total = contextUsed(ctx.session?.tokens)
  if (total === 0 || value === 0) return undefined
  return [
    { text: compact(value), tone: "text" as const },
    { text: ` · ${Math.round((value / total) * 100)}%`, tone: "muted" as const },
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
     * One solid bar: filled cells in the gauge rule's tone, empty cells a solid dark track. Not `░`,
     * which reads as floating gaps, and not `─`, which reads as a row of dashes. One tone for the
     * whole fill, not a gradient: green at 13% and olive at 12% was a colour nobody could read.
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
      return {
        runs: [
          { text: "█".repeat(filled), tone: gaugeTone(ratio) },
          { text: "█".repeat(BAR - filled), tone: "border" },
        ],
      }
    },

    /** The whole window, and how full it is. */
    tokens(ctx: StatusContext) {
      const total = contextUsed(ctx.session?.tokens)
      if (total === 0) return undefined
      const ratio = contextRatio(ctx.session)
      return row("tokens", [
        { text: compact(total), tone: "text" },
        ...(ratio === undefined ? [] : [{ text: ` · ${Math.round(ratio * 100)}%`, tone: level(ratio) }]),
      ])
    },

    /** Fresh prompt tokens: neither cached nor generated. */
    in(ctx: StatusContext) {
      const value = share(ctx, ctx.session?.tokens?.input ?? 0)
      return value && row("in", value)
    },

    /** What the model wrote, reasoning included. */
    out(ctx: StatusContext) {
      const tokens = ctx.session?.tokens
      const value = share(ctx, (tokens?.output ?? 0) + (tokens?.reasoning ?? 0))
      return value && row("out", value)
    },

    /** Served from the prompt cache — cheap, and usually most of the window. */
    cache(ctx: StatusContext) {
      const value = share(ctx, ctx.session?.tokens?.cache.read ?? 0)
      return value && row("cache", value)
    },

    /** Written into the cache this session — a one-time premium each. Not the same as "out". */
    write(ctx: StatusContext) {
      const value = share(ctx, ctx.session?.tokens?.cache.write ?? 0)
      return value && row("write", value)
    },

    /** A hairline, to group without a heading that might strand itself. */
    sep() {
      return { runs: [{ text: "─".repeat(14), tone: "border", dim: true }] }
    },

    /** Spent so far against the cap: a figure, coloured only once the budget is a level to watch. */
    spend(_ctx: StatusContext, config: SegmentConfig) {
      const state = spendState(config)
      if (!state) return undefined
      return row("spend", [{ text: `$${state.total.toFixed(2)}`, tone: level(state.total / state.cap) }])
    },

    /** What is left, and the share of the cap that decides whether it earns a colour. */
    avail(_ctx: StatusContext, config: SegmentConfig) {
      const state = spendState(config)
      if (!state) return undefined
      const left = Math.max(0, state.cap - state.total)
      const tone = level(state.total / state.cap)
      return row("avail", [
        { text: `$${left.toFixed(2)}`, tone },
        { text: ` · ${Math.round((left / state.cap) * 100)}% left`, tone: tone === "text" ? "muted" : tone },
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
