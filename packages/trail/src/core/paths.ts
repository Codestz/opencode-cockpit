/**
 * Where a project's trail lives on disk — Trust's scheme (`trust/src/core/paths.ts`), its own folder.
 *
 * Pure: creates nothing, reads nothing, and takes its environment as an argument.
 *
 * **Outside the project.** What your conversations made is about you and your sessions, not the
 * work; a trail in the repo would turn up in `git status` and travel to everyone who clones it.
 *
 * **Keyed by the project's full path**: the last two segments to read, a short hash of the whole to
 * be certain (`~/a/web` and `~/b/web` are two trails).
 */

import { createHash } from "node:crypto"
import { homedir } from "node:os"
import { join } from "node:path"

export interface TrailPaths {
  dir: string
  /** The append-only trail: one event per line. */
  events: string
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

export function trailPaths(
  directory: string,
  env: { [name: string]: string | undefined } = process.env,
): TrailPaths {
  const base =
    env.COCKPIT_HOME ??
    join(env.XDG_DATA_HOME ?? join(env.HOME ?? homedir(), ".local", "share"), "opencode-cockpit")
  const dir = join(base, "trail", `${projectSlug(directory)}-${shortHash(directory)}`)
  return { dir, events: join(dir, "events.ndjson") }
}
