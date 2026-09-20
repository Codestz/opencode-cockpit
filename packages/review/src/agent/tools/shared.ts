/**
 * What the review tools have in common: the threads on disk, and the words used to describe them.
 *
 * The server half has no interface and no daemon. It reads and writes the same directory the panel
 * does — one file per thread — which is the whole reason that shape was chosen: two writers who
 * almost never touch the same bytes.
 */

import type { PluginInput } from "@opencode-ai/plugin"
import { hasDrifted, type Thread, threadWhere, waitingOn } from "../../core/model/thread.ts"
import type { Persistence } from "../../core/store/persist.ts"

export interface ToolDeps {
  opencode: PluginInput["client"]
  directory: string
  /** The threads for whatever branch is checked out now, re-resolved per call. */
  store: () => Promise<Persistence>
  /** A file's current text, for checking whether a resolve is believable. */
  contentsOf: (path: string) => Promise<string | undefined>
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

/** One thread, as a line an agent can read without another call. */
export function describe(thread: Thread, after: string | undefined): string {
  const waiting = waitingOn(thread)
  const state = thread.status === "resolved" ? "resolved" : `${thread.status}, waiting on ${waiting}`
  const drifted = hasDrifted(thread, after) ? " · code has changed since" : ""
  const said = thread.entries.map((entry) => `    ${entry.author}: ${entry.body}`).join("\n")
  const quoted = thread.quoted?.length
    ? `\n  code as it was:\n${thread.quoted.map((line) => `    ${line}`).join("\n")}`
    : ""
  return `${thread.id}  ${thread.file} · ${threadWhere(thread)}  [${state}${drifted}]\n${said}${quoted}`
}
