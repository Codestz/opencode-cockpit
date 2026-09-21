import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Thread } from "../../src/core/model/thread.ts"
import { reviewPaths } from "../../src/core/store/paths.ts"
import { createPersistence } from "../../src/core/store/persist.ts"

/**
 * Driven against a real directory rather than a mocked one. The thing under test is the filesystem's
 * behaviour — atomic renames, a directory that is not there yet, a file someone corrupted — and a
 * mock would only agree with whatever this code already believed.
 */

let home: string
const store = () => createPersistence(reviewPaths("/p/cockpit", "main", { COCKPIT_HOME: home }))

const thread = (over: Partial<Thread> = {}): Thread => ({
  id: "rv_000000001",
  file: "a.ts",
  line: 2,
  entries: [{ author: "you", body: "why?", at: 1 }],
  status: "open",
  ...over,
})

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "cockpit-review-"))
})
afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

describe("keeping a review", () => {
  test("a thread written is a thread read back", async () => {
    const persistence = store()
    await persistence.save(thread())
    expect(await persistence.load()).toEqual([thread()])
  })

  test("a fresh branch has no directory, and that is an empty review rather than an error", async () => {
    expect(await store().load()).toEqual([])
  })

  test("each thread is its own file, so two writers rarely touch the same bytes", async () => {
    const persistence = store()
    await persistence.save(thread({ id: "rv_000000001" }))
    await persistence.save(thread({ id: "rv_000000002" }))
    expect((await readdir(persistence.dir)).sort()).toEqual(["rv_000000001.json", "rv_000000002.json"])
  })

  test("saving the same thread again replaces it", async () => {
    const persistence = store()
    await persistence.save(thread())
    await persistence.save(thread({ status: "resolved" }))
    const loaded = await persistence.load()
    expect(loaded).toHaveLength(1)
    expect(loaded[0]?.status).toBe("resolved")
  })

  test("removing takes only the thread asked for", async () => {
    const persistence = store()
    await persistence.save(thread({ id: "rv_000000001" }))
    await persistence.save(thread({ id: "rv_000000002" }))
    await persistence.remove("rv_000000001")
    expect((await persistence.load()).map((each) => each.id)).toEqual(["rv_000000002"])
  })

  test("removing something that was never there is not an error", async () => {
    await expect(store().remove("rv_nothing")).resolves.toBeUndefined()
  })

  test("threads come back oldest first, because ids sort by age", async () => {
    const persistence = store()
    await persistence.save(thread({ id: "rv_000000002" }))
    await persistence.save(thread({ id: "rv_000000001" }))
    expect((await persistence.load()).map((each) => each.id)).toEqual(["rv_000000001", "rv_000000002"])
  })
})

describe("when the directory has been meddled with", () => {
  test("a file that will not parse costs one thread, not the review", async () => {
    const persistence = store()
    await persistence.save(thread())
    await writeFile(join(persistence.dir, "broken.json"), "{ not json", "utf8")
    expect(await persistence.load()).toHaveLength(1)
  })

  test("files that are not ours are left alone", async () => {
    const persistence = store()
    await persistence.save(thread())
    await writeFile(join(persistence.dir, "README"), "hello", "utf8")
    expect(await persistence.load()).toHaveLength(1)
  })

  test("a half-written file is never read, because writes land by rename", async () => {
    const persistence = store()
    await persistence.save(thread())
    await writeFile(join(persistence.dir, "rv_x.json.writing"), "{ half", "utf8")
    expect(await persistence.load()).toHaveLength(1)
  })
})

describe("two saves at once", () => {
  /** Typing a note is a burst of saves for one id; overlapping writes must not interleave. */
  test("the last one wins, and the file is whole", async () => {
    const persistence = store()
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        persistence.save(thread({ entries: [{ author: "you", body: `body ${index}`, at: index }] })),
      ),
    )
    const loaded = await persistence.load()
    expect(loaded).toHaveLength(1)
    expect(loaded[0]?.entries[0]?.body).toMatch(/^body \d+$/)
  })
})
