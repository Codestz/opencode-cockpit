/**
 * The key a project's secrets are hashed with in signatures (core/secret.ts).
 *
 * Kept beside the ledger as `mask.key`, readable by you alone, and never written into the ledger: a
 * hash under a key no one else has cannot be checked against guesses, so a short password in a
 * masked command stays unknown even to someone holding the ledger. Every window of a project reads
 * the same key, so one command is one signature everywhere.
 *
 * Read once, synchronously, when Trust starts: a few bytes, before the first request can be asked.
 * If it cannot be read or made, this window hashes with a key of its own and says so — its masks
 * then match no other window's, which costs approvals and never shows a secret.
 */

import { createHmac, randomBytes } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import type { Log } from "@opencode-cockpit/client/log"
import type { TrustPaths } from "../core/paths.ts"
import type { Hasher } from "../core/secret.ts"

const KEY = /^[0-9a-f]{64}$/

function loadKey(paths: TrustPaths): string {
  try {
    const found = readFileSync(paths.key, "utf8").trim()
    if (KEY.test(found)) return found
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
  const made = randomBytes(32).toString("hex")
  mkdirSync(paths.dir, { recursive: true })
  try {
    /** `wx`: two windows starting at once — the one that loses reads the winner's key. */
    writeFileSync(paths.key, `${made}\n`, { flag: "wx", mode: 0o600 })
    return made
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
    const theirs = readFileSync(paths.key, "utf8").trim()
    if (KEY.test(theirs)) return theirs
    throw new Error("mask.key is not a key")
  }
}

export const keyedHash =
  (key: string): Hasher =>
  (value) =>
    createHmac("sha256", key).update(value).digest("hex").slice(0, 6)

export function maskHasher(paths: TrustPaths, log: Log): Hasher {
  try {
    return keyedHash(loadKey(paths))
  } catch (error) {
    log.warn("mask key unavailable — secrets hashed with this window's own key", { file: paths.key, error })
    return keyedHash(randomBytes(32).toString("hex"))
  }
}
