/**
 * What the review tools have in common: the threads on disk, and the words used to describe them.
 *
 * The server half has no interface and no daemon. It reads and writes the same directory the panel
 * does — one file per thread — which is the whole reason that shape was chosen: two writers who
 * almost never touch the same bytes.
 */

import type { Thread } from "../../core/model/thread.ts"
import type { Persistence } from "../../core/store/persist.ts"

/** Where `describe` lives now: submit sends the same prose when the agent has no tools. */
export { describeThread as describe } from "../../core/model/thread.ts"

export interface FileContents {
  /** As the diff and the store know it. */
  path: string
  text: string
}

export interface ToolDeps {
  directory: string
  /** The threads for whatever branch is checked out now, re-resolved per call. */
  store: () => Promise<Persistence>
  /**
   * A file's current text *and the path it turned out to be*.
   *
   * Both, because an agent names a file the way it has it in hand and the review has to store the path
   * the diff uses. Returning only the text let `review_open` write a thread under whatever the agent
   * typed — a note the panel would never show, because it was filed against a path that does not
   * appear in the diff.
   */
  contentsOf: (path: string) => Promise<FileContents | undefined>
}

export interface ToolKit extends ToolDeps {
  /** Finds a thread by id, or by the file and line an agent has just been told about. */
  find: (
    threads: readonly Thread[],
    by: { id?: string; file?: string; line?: number },
  ) => Thread | { ambiguous: Thread[] } | undefined
}

export function createToolKit(deps: ToolDeps): ToolKit {
  return {
    ...deps,
    /**
     * Addressable the way Shell's shells are: by id, or by what the agent actually has in hand.
     *
     * An agent that has just read `a.ts:41` should not have to carry an opaque id back to say
     * something about it — and when a file and line match more than one thread, saying so beats
     * guessing.
     */
    find(threads, by) {
      if (by.id) return threads.find((thread) => thread.id === by.id)
      if (!by.file) return undefined
      const matches = threads.filter((thread) => {
        if (!thread.file.endsWith(by.file as string)) return false
        if (by.line === undefined) return true
        const from = thread.line ?? 0
        const to = thread.through ?? from
        return by.line >= from && by.line <= to
      })
      if (matches.length === 1) return matches[0]
      return matches.length > 1 ? { ambiguous: matches } : undefined
    },
  }
}
