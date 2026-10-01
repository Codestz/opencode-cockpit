/**
 * The ledger file, read and appended without ever blocking the interface thread.
 *
 * Every read and every append goes through one chain, so this window's writes and reads never
 * overlap each other (the lesson of Review's trace: unserialised appends dropped lines). Other
 * windows append to the same file between our reads; `read` takes whatever whole lines arrived since
 * the last one and leaves a line still being written for next time.
 */

import { appendFile, mkdir, open } from "node:fs/promises"
import { type Event, parseLines, serialize } from "../core/ledger.ts"
import type { TrustPaths } from "../core/paths.ts"

export interface Journal {
  /** Events added since the last read, by anyone, in file order. `reset`: the file was replaced. */
  read: () => Promise<{ events: Event[]; reset: boolean }>
  append: (events: readonly Event[]) => Promise<void>
}

export function createJournal(paths: TrustPaths): Journal {
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
  }
}
