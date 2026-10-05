/**
 * The trail file, read and appended without ever blocking the interface thread — Trust's journal
 * (`trust/src/tui/journal.ts`), here in core because both halves write: the agent half on
 * `trail_add`, the interface on `a` and `x`.
 *
 * Every read and every append goes through one chain, so this reader's writes and reads never overlap
 * (unserialised appends dropped lines in Review's trace). Other windows — and on OpenCode 1, another
 * agent instance per directory — append to the same file between our reads; `read` takes whatever
 * whole lines arrived since the last one and leaves a line still being written for next time.
 *
 * `sync` is the reconcile: the events since the last read folded into the caller's state, the whole
 * file folded again when it was replaced. Event ids make a line read twice harmless.
 */

import { appendFile, mkdir, open } from "node:fs/promises"
import type { TrailPaths } from "../core/paths.ts"
import { applyAll, type Event, emptyState, parseLines, type State, serialize } from "../core/store.ts"

export interface Journal {
  /** Events added since the last read, by anyone, in file order. `reset`: the file was replaced. */
  read: () => Promise<{ events: Event[]; reset: boolean }>
  append: (events: readonly Event[]) => Promise<void>
  /** `state` brought up to the file: new events applied, or a fresh fold after a reset. */
  sync: (state: State) => Promise<State>
}

export function createJournal(paths: TrailPaths): Journal {
  let offset = 0
  let chain: Promise<unknown> = Promise.resolve()
  let made = false
  const decoder = new TextDecoder()

  const queue = <T>(task: () => Promise<T>): Promise<T> => {
    const run = chain.then(task, task)
    chain = run.catch(() => {})
    return run
  }

  const read = async (): Promise<{ events: Event[]; reset: boolean }> => {
    let handle: Awaited<ReturnType<typeof open>> | undefined
    try {
      handle = await open(paths.events, "r")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { events: [], reset: false }
      throw error
    }
    try {
      const { size } = await handle.stat()
      /** Smaller than what we read: someone replaced the file. Start again from its first line. */
      const reset = size < offset
      if (reset) offset = 0
      if (size === offset) return { events: [], reset }
      const buffer = new Uint8Array(size - offset)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset)
      const bytes = buffer.subarray(0, bytesRead)
      const end = bytes.lastIndexOf(10) // the last newline: what follows is still being written
      if (end < 0) return { events: [], reset }
      const { events } = parseLines(decoder.decode(bytes.subarray(0, end + 1)))
      offset += end + 1
      return { events, reset }
    } finally {
      await handle.close()
    }
  }

  return {
    read: () => queue(read),
    append: (events) =>
      queue(async () => {
        if (events.length === 0) return
        if (!made) {
          await mkdir(paths.dir, { recursive: true })
          made = true
        }
        /** One write for the batch: whole lines, appended, never interleaved with another window's. */
        await appendFile(paths.events, events.map(serialize).join(""))
      }),
    sync: (state) =>
      queue(async () => {
        const { events, reset } = await read()
        return applyAll(reset ? emptyState() : state, events)
      }),
  }
}
