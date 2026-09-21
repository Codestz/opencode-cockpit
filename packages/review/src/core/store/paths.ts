/**
 * Where a review lives on disk.
 *
 * Pure: creates nothing, reads nothing, and takes its environment as an argument so the whole layout
 * can be tested without touching a filesystem. Mirrors `@opencode-cockpit/protocol`'s paths helper,
 * which does the same for the daemon.
 *
 * Two decisions are encoded here.
 *
 * **A review is about the work, so it is keyed by branch.** Not by conversation: you read a branch,
 * leave notes, the agent answers them, and somewhere in the middle you may well start a new chat —
 * that should no more lose your review than it loses your branch.
 *
 * **It lives outside the project.** Not `.cockpit/` in the repo: a review is not part of the work, and
 * the first time it turns up in someone's `git status` it becomes a thing to explain in a pull
 * request. `XDG_DATA_HOME` rather than the cache directory, because losing a half-finished review to
 * a cache sweep would be losing a half-finished job.
 */

import { homedir } from "node:os"
import { join } from "node:path"

export interface ReviewPaths {
  /** The directory holding this branch's threads, one JSON file each. */
  dir: string
  /** Where a single thread is written. */
  fileFor: (id: string) => string
  /**
   * Where trouble is appended — a stack, and what was true when it happened.
   *
   * Beside the threads rather than in a global log, because a crash belongs to the review that produced
   * it: the branch, the files, the notes already written are all the context worth having.
   */
  log: string
}

/**
 * Anything that is not plainly a filename becomes a dash.
 *
 * Branch names carry slashes (`feat/review-bay`), project paths carry everything, and neither may be
 * allowed to walk out of the directory it was meant to name.
 */
export function slug(text: string): string {
  const cleaned = text
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 60)
  return cleaned.length > 0 ? cleaned : "unnamed"
}

/** The last two segments of a path, which is enough to tell two checkouts apart while staying short. */
export function projectSlug(directory: string): string {
  const parts = directory.split("/").filter(Boolean)
  return slug(parts.slice(-2).join("-"))
}

export function reviewPaths(
  directory: string,
  branch: string | undefined,
  env: Record<string, string | undefined> = process.env,
): ReviewPaths {
  const base =
    env.COCKPIT_HOME ?? join(env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "opencode-cockpit")
  /** No branch is not an error: a project without a repository still has a conversation to review. */
  const dir = join(base, "review", `${projectSlug(directory)}-${slug(branch ?? "no-branch")}`)
  return { dir, fileFor: (id) => join(dir, `${slug(id)}.json`), log: join(dir, "trouble.log") }
}
