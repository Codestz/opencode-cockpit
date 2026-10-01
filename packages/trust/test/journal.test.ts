import { describe, expect, test } from "bun:test"
import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type Event, serialize } from "../src/core/ledger.ts"
import { trustPaths } from "../src/core/paths.ts"
import { createJournal } from "../src/tui/journal.ts"

const paths = () => trustPaths("/work/app", { COCKPIT_HOME: mkdtempSync(join(tmpdir(), "trust-journal-")) })
const paused = (at: number): Event => ({ v: 1, at, type: "paused" })

describe("the ledger file", () => {
  test("nothing there yet is nothing to read", async () => {
    expect(await createJournal(paths()).read()).toEqual({ events: [], reset: false })
  })

  test("appends are read back once, in order", async () => {
    const journal = createJournal(paths())
    await journal.append([paused(1), paused(2)])
    expect((await journal.read()).events).toEqual([paused(1), paused(2)])
    expect((await journal.read()).events).toEqual([])
    await journal.append([paused(3)])
    expect((await journal.read()).events).toEqual([paused(3)])
  })

  test("two windows on one file each read the other's events", async () => {
    const where = paths()
    const one = createJournal(where)
    const two = createJournal(where)
    await one.append([paused(1)])
    await two.append([paused(2)])
    expect((await one.read()).events).toEqual([paused(1), paused(2)])
    expect((await two.read()).events).toEqual([paused(1), paused(2)])
  })

  test("a line still being written waits; a torn one is survived", async () => {
    const where = paths()
    const journal = createJournal(where)
    await journal.append([paused(1)])
    await journal.read()
    appendFileSync(where.events, serialize(paused(2)).slice(0, 10))
    expect((await journal.read()).events).toEqual([])
    /** The writer died; the next window appends straight after the remains. */
    appendFileSync(where.events, serialize(paused(3)))
    expect((await journal.read()).events).toEqual([paused(3)])
  })

  test("a replaced file is read again from the start", async () => {
    const where = paths()
    const journal = createJournal(where)
    await journal.append([paused(1), paused(2), paused(3)])
    await journal.read()
    writeFileSync(where.events, serialize(paused(9)))
    expect(await journal.read()).toEqual({ events: [paused(9)], reset: true })
  })
})
