/**
 * Where a project's ledger lives on disk.
 *
 * Pure: creates nothing, reads nothing, and takes its environment as an argument — as Review's
 * `core/store/paths.ts` does, which this mirrors.
 *
 * **Outside the project.** What you have approved is about you, not the work; a ledger in the repo
 * would turn up in `git status` and, worse, travel to everyone who clones it — trust you earned would
 * answer for them.
 *
 * **Keyed by the project's full path.** The readable part is the last two segments, which tells two
 * checkouts apart at a glance but not for certain (`~/a/web` and `~/b/web`); a short hash of the whole
 * path makes it certain, so one checkout's trust can never answer in another.
 */

import { createHash } from "node:crypto"
import { homedir } from "node:os"
import { join } from "node:path"

export interface TrustPaths {
  dir: string
  /** The append-only ledger: one event per line. */
  events: string
  /** The key secrets are hashed with in signatures (core/secret.ts): beside the ledger, never in it. */
  key: string
}

/** Anything that is not plainly a filename becomes a dash. */
export function slug(text: string): string {
  const cleaned = text
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 60)
  return cleaned.length > 0 ? cleaned : "unnamed"
}

export function projectSlug(directory: string): string {
  const parts = directory.split("/").filter(Boolean)
  return slug(parts.slice(-2).join("-"))
}

export function shortHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 8)
}

export function trustPaths(
  directory: string,
  env: Record<string, string | undefined> = process.env,
): TrustPaths {
  const base =
    env.COCKPIT_HOME ??
    join(env.XDG_DATA_HOME ?? join(env.HOME ?? homedir(), ".local", "share"), "opencode-cockpit")
  const dir = join(base, "trust", `${projectSlug(directory)}-${shortHash(directory)}`)
  return { dir, events: join(dir, "events.ndjson"), key: join(dir, "mask.key") }
}
