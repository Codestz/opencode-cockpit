/**
 * How much is uncommitted, read from git rather than from the host.
 *
 * The line used to ask OpenCode what *this session* changed. That number was only ever as good as
 * the host's own file list, it could not be checked against anything, and a reader had no way to
 * tell an idle session from a feed that was not being filled — both render as nothing. Git is the
 * thing everyone already trusts, it answers whether a session exists or not, and `git diff` in the
 * same directory will always agree with it.
 */

export interface DiffCounts {
  files: number
  additions: number
  deletions: number
}

/**
 * Parses `git diff --shortstat`.
 *
 * The suffixes matter: git writes `125 insertions(+), 66 deletions(-)`, so a pattern that expects a
 * comma straight after `insertions` stops matching before the deletions and reports `-0` for ever.
 * It is an easy mistake — this parser exists partly because it was found in the wild.
 */
export function parseShortstat(text: string): DiffCounts | undefined {
  const found =
    /(\d+)\s+files?\s+changed(?:,\s*(\d+)\s+insertions?[^,]*)?(?:,\s*(\d+)\s+deletions?[^,]*)?/.exec(text)
  if (!found) return undefined
  return {
    files: Number(found[1]),
    additions: Number(found[2] ?? 0),
    deletions: Number(found[3] ?? 0),
  }
}

/**
 * What is uncommitted: staged and unstaged together, against `HEAD`.
 *
 * Untracked files are left out, because git cannot count lines in a file it has never seen and a
 * file count that moved without the line counts moving reads as a bug.
 */
export const UNCOMMITTED = "git diff --shortstat HEAD"

/**
 * Whether any line actually asks for the counts.
 *
 * Nothing should spawn a process for a number nobody is going to draw. A line with no `git.diff` on
 * it — and a great many are — costs exactly what it did before this segment learned to use git.
 */
export function wantsDiff(
  lines: ReadonlyArray<{ segments: ReadonlyArray<string | { type?: string }> }>,
): boolean {
  return lines.some((line) =>
    line.segments.some((segment) => {
      const name = typeof segment === "string" ? segment : segment.type
      return name === "git.diff" || name === "session.diff"
    }),
  )
}
