/**
 * The rows of the sidebar's table: a heading, the tokens by where they went, a proxy's budget, the
 * branch's diff, and the hairlines between the groups.
 *
 * They were the `sidebar-budget` example's, a layout a user arrived at after five rejected
 * iterations, and became built-ins when it became the `sidebar` preset — so the default needs no
 * module. Three rules from it hold every row here: the word is the label, in a fixed column so the
 * figures line up; a row whose figure is zero is not drawn (`write 0 · 0%` said nothing, at length);
 * and colour is a level — calm until a threshold, then the warning, then the error — never a category.
 */

import { GAUGE, gaugeTone } from "@opencode-cockpit/client/design"
import type { StatusContext } from "../context.ts"
import { contextUsed } from "../context.ts"
import { compact } from "../format.ts"
import type { Run, SegmentDef, Tone } from "../types.ts"
import { num, str } from "./settings.ts"

/**
 * The label column, padded so every figure starts in the same place. Seven: the longest label is
 * `tokens`, and at six it ran into its own figure (`tokens167.8k`).
 */
export const LABEL = 7

export function labelled(label: string, value: Run[]): { runs: Run[] } {
  return { runs: [{ text: label.padEnd(LABEL), tone: "muted" }, ...value] }
}

/** A level's tone: the text colour until it is worth a colour, so a column of figures is not a column of greens. */
export const level = (ratio: number): Tone => (ratio >= GAUGE.warnAt ? gaugeTone(ratio) : "text")

const widthOf = (runs: readonly Run[]) => runs.reduce((sum, run) => sum + run.text.length, 0)

/** `extra` when the row still fits the room with it, so a narrow column loses a word rather than a figure. */
function ifRoom(ctx: StatusContext, runs: Run[], extra: Run): Run[] {
  return widthOf(runs) + LABEL + extra.text.length <= ctx.width ? [...runs, extra] : runs
}

/** One token row: its own figure, and its share of the window. Zero is not a row. */
function share(ctx: StatusContext, label: string, value: number): { runs: Run[] } | undefined {
  const total = contextUsed(ctx.session?.tokens)
  if (total === 0 || value === 0) return undefined
  return labelled(label, [
    { text: compact(value), tone: "text" },
    { text: ` · ${Math.round((value / total) * 100)}%`, tone: "muted" },
  ])
}

export const SEGMENTS: SegmentDef[] = [
  {
    /** The column's subject, so the table under it has one; `text` names it something else. */
    name: "title",
    priority: 90,
    render(_ctx, config) {
      return { runs: [{ text: str(config, "text") ?? "Context", tone: "text", bold: true }] }
    },
  },
  {
    /** Fresh prompt tokens: neither cached nor generated. */
    name: "in",
    priority: 35,
    render: (ctx) => share(ctx, "in", ctx.session?.tokens?.input ?? 0),
  },
  {
    /** What the model wrote, reasoning included. */
    name: "out",
    priority: 35,
    render(ctx) {
      const tokens = ctx.session?.tokens
      return share(ctx, "out", (tokens?.output ?? 0) + (tokens?.reasoning ?? 0))
    },
  },
  {
    /** Served from the prompt cache — cheap, and usually most of the window. */
    name: "cache",
    priority: 35,
    render: (ctx) => share(ctx, "cache", ctx.session?.tokens?.cache.read ?? 0),
  },
  {
    /** Written into the cache this session — a one-time premium each. Not the same as `out`. */
    name: "write",
    priority: 30,
    render: (ctx) => share(ctx, "write", ctx.session?.tokens?.cache.write ?? 0),
  },
  {
    /**
     * A hairline, to group without a heading that might strand itself. Drawn only between two rows:
     * one with nothing under it, or under another, is left out.
     */
    name: "sep",
    priority: 5,
    divider: true,
    render(_ctx, config) {
      return {
        runs: [{ text: "─".repeat(Math.max(1, num(config, "width", 14))), tone: "border", dim: true }],
      }
    },
  },
  {
    /** Spent so far against the cap: a figure, coloured only once the budget is a level to watch. */
    name: "spend",
    priority: 60,
    render(ctx) {
      const budget = ctx.budget
      if (!budget) return undefined
      return labelled("spend", [
        { text: `$${budget.spent.toFixed(2)}`, tone: level(budget.spent / budget.cap) },
      ])
    },
  },
  {
    /** What is left, and the share of the cap that decides whether it earns a colour. */
    name: "avail",
    priority: 60,
    render(ctx) {
      const budget = ctx.budget
      if (!budget) return undefined
      const left = Math.max(0, budget.cap - budget.spent)
      const tone = level(budget.spent / budget.cap)
      const runs: Run[] = [
        { text: `$${left.toFixed(2)}`, tone },
        { text: ` · ${Math.round((left / budget.cap) * 100)}%`, tone: tone === "text" ? "muted" : tone },
      ]
      return labelled("avail", ifRoom(ctx, runs, { text: " left", tone: tone === "text" ? "muted" : tone }))
    },
  },
  {
    /**
     * What git would commit: the uncommitted files, by default — what this work has changed that is
     * not saved anywhere yet. `"against": "branch"` counts the whole branch against where it forked
     * instead (every commit plus what is uncommitted, `vs main`), the reviewer's view.
     */
    name: "git",
    priority: 50,
    render(ctx, config) {
      const branch = config.against === "branch"
      const diff = branch ? ctx.branchDiff : ctx.diff
      if (!diff || diff.files === 0) return undefined
      const runs: Run[] = [
        { text: `${diff.files}f`, tone: "muted" },
        { text: ` +${compact(diff.additions)}`, tone: "success" },
        { text: ` -${compact(diff.deletions)}`, tone: "error" },
      ]
      return labelled(
        "git",
        branch
          ? ifRoom(ctx, runs, { text: ` vs ${ctx.defaultBranch ?? "main"}`, tone: "muted", dim: true })
          : runs,
      )
    },
  },
]
