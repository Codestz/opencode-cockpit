/**
 * Keeping a review between restarts, and sharing it between halves.
 *
 * One file per thread, for one reason that matters: this store is about to have **two writers**. The
 * interface writes when you leave a note; the server half writes when the agent answers one. A single
 * document would mean read-modify-write from both, and whoever lost the race would silently lose a
 * note. Separate files means they almost never touch the same bytes — you open threads, the agent
 * updates the ones it is answering — and a bad write costs one thread instead of the review.
 *
 * The directory listing is the index. An index file would be a second thing to keep in step, which is
 * its own class of bug.
 */

import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { Thread } from "../model/thread.ts"
import { decode, encode } from "./format.ts"
import type { ReviewPaths } from "./paths.ts"

export interface Persistence {
  /** Every thread on disk, oldest first. Missing directory means an empty review, not an error. */
  load: () => Promise<Thread[]>
  /** Writes one thread. Safe to call on every keystroke; the last call for an id wins. */
  save: (thread: Thread) => Promise<void>
  remove: (id: string) => Promise<void>
  /** Where these threads live, for saying so when something is wrong. */
  dir: string
}

export function createPersistence(paths: ReviewPaths): Persistence {
  /**
   * Writes are serialised per thread.
   *
   * Typing a note is a burst of saves for the same id, and two overlapping writes to one file can
   * interleave into something neither of them meant.
   */
  const pending = new Map<string, Promise<unknown>>()
  const queue = (id: string, work: () => Promise<unknown>): Promise<void> => {
    const next = (pending.get(id) ?? Promise.resolve()).then(work, work)
    pending.set(
      id,
      next.catch(() => {}),
    )
    return next.then(() => undefined)
  }

  return {
    dir: paths.dir,

    async load() {
      let names: string[]
      try {
        names = await readdir(paths.dir)
      } catch {
        /** No directory is an empty review, which is the ordinary case on a fresh branch. */
        return []
      }
      const threads: Thread[] = []
      for (const name of names) {
        if (!name.endsWith(".json")) continue
        try {
          const thread = decode(await readFile(join(paths.dir, name), "utf8"))
          /** A file that will not parse is skipped, not fatal: one bad thread is not a bad review. */
          if (thread) threads.push(thread)
        } catch {
          // Unreadable for any other reason — permissions, a race with a delete — is the same answer.
        }
      }
      return threads.sort((a, b) => a.id.localeCompare(b.id))
    },

    save(thread) {
      return queue(thread.id, async () => {
        await mkdir(paths.dir, { recursive: true })
        /**
         * Written beside its destination and renamed onto it, so a reader never sees half a thread.
         * A rename within a directory is atomic; a write in place is not.
         */
        const target = paths.fileFor(thread.id)
        const temporary = `${target}.writing`
        await writeFile(temporary, encode(thread), "utf8")
        await rename(temporary, target)
      })
    },

    remove(id) {
      return queue(id, () => rm(paths.fileFor(id), { force: true }))
    },
  }
}
