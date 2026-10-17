/**
 * The rules snapshot: OpenCode's permission rules as the interface last read them, beside the ledger
 * as `rules.json`, for the agent half to decide with.
 *
 * OpenCode 2 gives a server plugin no config to read, and the agent half answers before any request
 * is made (agent/answer.ts) — so it decides with what the interface was told. The interface writes
 * the snapshot each time it reads the config (at start, and on every `config.updated`), and removes it
 * when the config cannot be read, since then the interface answers nothing either. It carries the
 * interface's settings too, so both halves count to the same threshold whatever their entries say.
 *
 * Only the permissions are written (`rulesConfig`), never the rest of the config: a config holds
 * providers and their keys. Written whole or not at all — to a file of its own, then renamed over the
 * old one — so a reader never sees half of it. And it names the process that wrote it: a snapshot
 * whose interface is gone is not read, because nobody is keeping it current, and the agent half then
 * leaves every request to be asked.
 */

import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import type { TrustSettings } from "../core/config.ts"
import type { TrustPaths } from "../core/paths.ts"
import { rulesConfig } from "../core/rules.ts"

/** What decides alike in both halves. */
export type SnapshotSettings = Pick<TrustSettings, "threshold" | "dangerExtra" | "expireDays" | "learnReads">

export interface Snapshot {
  v: 1
  at: number
  /** The interface process that wrote it. */
  pid: number
  /** `config.get`'s answer with only its permissions: what `rulesFrom` reads. */
  config: unknown
  settings: SnapshotSettings
}

/** The rules as read now, or `undefined` when they could not be: the snapshot is then removed. */
export async function writeSnapshot(
  paths: TrustPaths,
  input: { config: unknown; settings: SnapshotSettings } | undefined,
  { pid = process.pid, now = Date.now() }: { pid?: number; now?: number } = {},
): Promise<void> {
  if (!input) {
    await rm(paths.rules, { force: true })
    return
  }
  const { threshold, dangerExtra, expireDays, learnReads } = input.settings
  const snapshot: Snapshot = {
    v: 1,
    at: now,
    pid,
    config: rulesConfig(input.config),
    settings: { threshold, dangerExtra, expireDays, learnReads },
  }
  await mkdir(paths.dir, { recursive: true })
  const temporary = `${paths.rules}.${pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(snapshot)}\n`, { mode: 0o600 })
  await rename(temporary, paths.rules)
}

/** Whether a process is running. `EPERM` is one that runs as someone else: running still. */
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

const isSnapshot = (value: unknown): value is Snapshot => {
  const raw = value as Partial<Snapshot> | undefined
  const settings = raw?.settings as Partial<SnapshotSettings> | undefined
  return (
    raw?.v === 1 &&
    typeof raw.at === "number" &&
    typeof raw.pid === "number" &&
    raw.config !== undefined &&
    typeof settings?.threshold === "number" &&
    typeof settings.dangerExtra === "number" &&
    typeof settings.expireDays === "number" &&
    typeof settings.learnReads === "boolean"
  )
}

/**
 * The snapshot, read again only when the file changed. `undefined` when there is none, it cannot be
 * read, or its interface is no longer running.
 */
export function snapshotReader(
  paths: TrustPaths,
  running: (pid: number) => boolean = alive,
): () => Promise<Snapshot | undefined> {
  let seen: { mtime: number; size: number; snapshot: Snapshot | undefined } | undefined
  return async () => {
    const found = await stat(paths.rules).catch(() => undefined)
    if (!found) {
      seen = undefined
      return undefined
    }
    if (!seen || seen.mtime !== found.mtimeMs || seen.size !== found.size) {
      const text = await readFile(paths.rules, "utf8").catch(() => undefined)
      let parsed: unknown
      try {
        parsed = text === undefined ? undefined : JSON.parse(text)
      } catch {
        parsed = undefined
      }
      seen = { mtime: found.mtimeMs, size: found.size, snapshot: isSnapshot(parsed) ? parsed : undefined }
    }
    return seen.snapshot && running(seen.snapshot.pid) ? seen.snapshot : undefined
  }
}
