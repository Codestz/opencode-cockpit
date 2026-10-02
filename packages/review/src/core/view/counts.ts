/**
 * What a file's change adds up to, in words and in colour.
 *
 * Shared, because the file list right-aligns these into a column and the diff's own header prints
 * them beside the path. Two copies of "how do we say +11 −3" is two places for them to stop agreeing.
 */

import type { FileChange } from "../model/review.ts"
import type { Run } from "./rows.ts"

export const tallyOf = (file: FileChange) =>
  [file.additions > 0 ? `+${file.additions}` : "", file.deletions > 0 ? `−${file.deletions}` : ""]
    .filter(Boolean)
    .join(" ")

/**
 * The same numbers, in their own colours.
 *
 * Grey `+11 −3` makes you read the digits to learn the shape of a change; green and red let you see it
 * without reading — which is the whole job of a file list you are scanning rather than studying.
 */
export const tallyRuns = (file: FileChange | undefined): Run[] => {
  if (!file) return []
  /** A file that deleted nothing does not need telling you so forty times down a list. */
  return [
    ...(file.additions > 0 ? [{ text: ` +${file.additions}`, tone: "added" as const }] : []),
    ...(file.deletions > 0 ? [{ text: ` −${file.deletions}`, tone: "removed" as const }] : []),
  ]
}

/**
 * What happened to the file itself: created, deleted, moved — or nothing worth a word, for an edit.
 *
 * Git says so where it can. Without that, a file with no "before" was created and one with no
 * "after" was deleted, which is what the counts alone could not tell apart from a rewrite.
 */
export function changeOf(file: FileChange | undefined): FileChange["change"] {
  if (!file) return undefined
  if (file.change) return file.change
  if (file.before === "" && file.after !== "") return "added"
  if (file.after === "" && file.before !== "") return "deleted"
  return undefined
}

/**
 * The word for it, short enough for a file list: `new`, `deleted`, `renamed`.
 *
 * A word rather than a badge — muted, after the name — because it is read once and then known, and
 * a coloured block beside every new file would shout on a branch that is mostly new files.
 */
export const changeWord = (file: FileChange | undefined): string => {
  const change = changeOf(file)
  return change === "added" ? "new" : (change ?? "")
}

/**
 * Columns a path keeps before the word after it gives way: the file's own name, whole, behind a `…`.
 * The folders can be cut to make room for the word; the name cannot.
 */
export const keeps = (path: string): number => {
  const name = path.slice(path.lastIndexOf("/") + 1)
  return Math.min(path.length, name.length + 1)
}

/** One row per tree entry: folders with a count, files with their basename and tally. */
