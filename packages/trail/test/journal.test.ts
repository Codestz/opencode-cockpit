import { describe, expect, test } from "bun:test"
import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createJournal } from "../src/core/journal.ts"
import { trailPaths } from "../src/core/paths.ts"
import { type Event, emptyState, serialize } from "../src/core/store.ts"

const paths = () => trailPaths("/work/app", { COCKPIT_HOME: mkdtempSync(join(tmpdir(), "trail-journal-")) })
const event = (id: string, url = `https://github.com/a/b/pull/${id}`): Event => ({
  v: 1,
  at: Number(id) || 1,
  id,
  type: "recorded",
  rootSession: "ses_1",
  session: "ses_1",
  by: "agent",
  title: `PR ${id}`,
  url,
  action: "created",
})

describe("where the trail lives", () => {
  test("outside the project, one folder per checkout", () => {
    const env = { HOME: "/home/me" }
    const a = trailPaths("/home/me/a/web", env)
    const b = trailPaths("/home/me/b/web", env)
    expect(a.events).toMatch(
      /^\/home\/me\/\.local\/share\/opencode-cockpit\/trail\/a-web-[0-9a-f]{8}\/events\.ndjson$/,
    )
    expect(a.dir).not.toBe(b.dir)
    expect(
      trailPaths("/x/y", { XDG_DATA_HOME: "/data" }).dir.startsWith("/data/opencode-cockpit/trail/"),
    ).toBe(true)
  })
})

describe("the trail file", () => {
  test("nothing there yet is nothing to read", async () => {
    expect(await createJournal(paths()).read()).toEqual({ events: [], reset: false })
  })

  test("appends are read back once, in order", async () => {
    const journal = createJournal(paths())
    await journal.append([event("1"), event("2")])
    expect((await journal.read()).events).toEqual([event("1"), event("2")])
    expect((await journal.read()).events).toEqual([])
  })

  test("several writers on one file — windows, or one agent instance per directory — each read all", async () => {
    const where = paths()
    const one = createJournal(where)
    const two = createJournal(where)
    const three = createJournal(where)
    await Promise.all([one.append([event("1")]), two.append([event("2")]), three.append([event("3")])])
    const state = await one.sync(emptyState())
    expect([...state.records.values()].map((record) => record.title).sort()).toEqual(["PR 1", "PR 2", "PR 3"])
    expect((await two.sync(emptyState())).records.size).toBe(3)
  })

  test("sync folds only what is new, and a line read twice counts once", async () => {
    const where = paths()
    const journal = createJournal(where)
    await journal.append([event("1")])
    let state = await journal.sync(emptyState())
    await createJournal(where).append([{ ...event("2", "https://github.com/a/b/pull/1"), action: "updated" }])
    state = await journal.sync(state)
    expect([...state.records.values()][0]?.history.map((step) => step.action)).toEqual(["created", "updated"])
    /** The same line appended again (a retried write) is the same event. */
    appendFileSync(where.events, serialize(event("1")))
    state = await journal.sync(state)
    expect([...state.records.values()][0]?.history).toHaveLength(2)
  })

  test("a torn last line waits; the next whole line after it is recovered", async () => {
    const where = paths()
    const journal = createJournal(where)
    await journal.append([event("1")])
    await journal.read()
    appendFileSync(where.events, serialize(event("2")).slice(0, 15))
    expect((await journal.read()).events).toEqual([])
    appendFileSync(where.events, serialize(event("3")))
    expect((await journal.read()).events).toEqual([event("3")])
  })

  test("a replaced file is folded again from its start", async () => {
    const where = paths()
    const journal = createJournal(where)
    await journal.append([event("1"), event("2"), event("3")])
    let state = await journal.sync(emptyState())
    expect(state.records.size).toBe(3)
    writeFileSync(where.events, serialize(event("9")))
    state = await journal.sync(state)
    expect([...state.records.values()].map((record) => record.title)).toEqual(["PR 9"])
  })
})
