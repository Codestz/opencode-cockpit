/**
 * A thread, to and from the text on disk.
 *
 * Pure, and deliberately forgiving in one direction only: writing is exact, reading assumes the file
 * may be anything at all. These files outlive the version that wrote them — a review is open across
 * restarts and upgrades — so a field that changes shape must cost one thread, not the review.
 */

import type { Author, Entry, Status, Thread } from "../model/thread.ts"

/** Bumped when the shape changes in a way a reader would get wrong. */
export const FORMAT = 1

const AUTHORS: readonly Author[] = ["you", "agent"]
const STATUSES: readonly Status[] = ["open", "answered", "resolved"]

export function encode(thread: Thread): string {
  return `${JSON.stringify({ format: FORMAT, ...thread }, null, 2)}\n`
}

const isEntry = (value: unknown): value is Entry => {
  if (typeof value !== "object" || value === null) return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry.body === "string" && typeof entry.at === "number" && AUTHORS.includes(entry.author as Author)
  )
}

/**
 * A thread, or nothing.
 *
 * Nothing is the right answer for a truncated write, a file someone edited by hand, or a shape from a
 * future version — and the caller skips it rather than failing to open the review at all.
 */
export function decode(text: string): Thread | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof parsed !== "object" || parsed === null) return undefined
  const raw = parsed as Record<string, unknown>

  if (typeof raw.id !== "string" || typeof raw.file !== "string") return undefined
  if (!Array.isArray(raw.entries)) return undefined
  const entries = raw.entries.filter(isEntry)
  /** A thread with nothing in it is not a thread; it is a file that lost its contents. */
  if (entries.length === 0) return undefined

  const status = STATUSES.includes(raw.status as Status) ? (raw.status as Status) : "open"
  const quoted =
    Array.isArray(raw.quoted) && raw.quoted.every((line) => typeof line === "string")
      ? (raw.quoted as string[])
      : undefined

  return {
    id: raw.id,
    file: raw.file,
    ...(typeof raw.line === "number" ? { line: raw.line } : {}),
    ...(typeof raw.through === "number" ? { through: raw.through } : {}),
    ...(quoted ? { quoted } : {}),
    entries,
    status,
  }
}
