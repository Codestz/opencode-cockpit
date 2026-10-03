/**
 * A budget a proxy keeps: what has been spent against a cap.
 *
 * OpenCode knows what a model costs only when a provider declares prices, and behind a proxy nobody
 * does — the proxy is the one that knows. LiteLLM's IAP plugin writes `{ baseline, delta, cap }` to a
 * small file; anything that writes the same shape will do. No file, no budget, and the rows that draw
 * it say nothing: a made-up figure would be worse than none.
 */

import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

export interface Budget {
  /** Spent so far. */
  spent: number
  /** The most that may be spent; always above zero. */
  cap: number
}

/** Where LiteLLM's IAP plugin writes it. A `file` on the `spend` or `avail` segment points elsewhere. */
export const budgetPath = (home = homedir()): string =>
  join(home, ".cache", "opencode-litellm-iap", "spend.json")

/** How often the file is read again: it is tiny, but the line repaints every second. */
export const BUDGET_EVERY_MS = 5_000

/** The file's text as a budget, or undefined when it is not one. */
export function parseBudget(text: string | undefined): Budget | undefined {
  if (text === undefined) return undefined
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return undefined
  }
  const { baseline, delta, cap } = (raw ?? {}) as { baseline?: unknown; delta?: unknown; cap?: unknown }
  if (typeof baseline !== "number" || typeof cap !== "number" || !(cap > 0)) return undefined
  return { spent: baseline + (typeof delta === "number" ? delta : 0), cap }
}

export function readBudget(path: string): Budget | undefined {
  try {
    return parseBudget(readFileSync(path, "utf8"))
  } catch {
    return undefined
  }
}

const BUDGET_SEGMENTS = new Set(["spend", "avail"])

/**
 * The file the lines want read, or undefined when no line draws a budget — nothing should touch the
 * disk for a figure nobody is going to draw. The first `file` written on a budget segment wins.
 */
export function budgetFile(
  lines: ReadonlyArray<{ segments: ReadonlyArray<string | { type?: string; file?: unknown }> }>,
  home = homedir(),
): string | undefined {
  let wanted = false
  for (const line of lines) {
    for (const segment of line.segments) {
      const name = typeof segment === "string" ? segment : segment.type
      if (!name || !BUDGET_SEGMENTS.has(name)) continue
      if (typeof segment !== "string" && typeof segment.file === "string") {
        return segment.file.startsWith("~/") ? resolve(home, segment.file.slice(2)) : segment.file
      }
      wanted = true
    }
  }
  return wanted ? budgetPath(home) : undefined
}
