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

/** One row per tree entry: folders with a count, files with their basename and tally. */
