import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ToolDefinition } from "@opencode-ai/plugin"
import { createTools } from "../../src/agent/tools/index.ts"
import type { Thread } from "../../src/core/model/thread.ts"
import { reviewPaths } from "../../src/core/store/paths.ts"
import { createPersistence } from "../../src/core/store/persist.ts"

/**
 * The half the person never sees.
 *
 * Driven against a real directory and the real tool definitions, because everything interesting here
 * is an interaction between the two: a resolve is only believable if the file on disk has changed, an
 * id is only useful if it survives a write, and a thread the agent opens has to be a thread the panel
 * can read. A mock of the store would agree with whatever this code already believed.
 */

let home: string
/** The file contents the agent's tools see, keyed by path. */
let files: Record<string, string>

const paths = () => reviewPaths("/p/cockpit", "feat/x", { COCKPIT_HOME: home })
const store = () => createPersistence(paths())

const tools = (): Record<string, ToolDefinition> =>
  createTools({
    opencode: {} as never,
    directory: "/p/cockpit",
    store: async () => store(),
    /**
     * Exactly as the host resolves one: the path given, or nothing. A fake that matched suffixes
     * would have hidden the bug this file found — a note filed under whatever the agent typed.
     */
    contentsOf: async (path) => (files[path] === undefined ? undefined : { path, text: files[path] }),
  })

/** Tool definitions carry their execute under `execute`; the context argument is unused here. */
const run = async (name: string, args: Record<string, unknown>): Promise<string> => {
  const tool = tools()[name] as ToolDefinition & {
    execute: (args: never, context: never) => Promise<string | { output?: string }>
  }
  const answer = await tool.execute(args as never, {} as never)
  return typeof answer === "string" ? answer : (answer.output ?? JSON.stringify(answer))
}

const thread = (over: Partial<Thread> = {}): Thread => ({
  id: "rv_000000001",
  file: "src/config.ts",
  line: 3,
  quoted: ["  const timeout = 30"],
  entries: [{ author: "you", body: "why thirty?", at: 1 }],
  status: "open",
  ...over,
})

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "cockpit-review-agent-"))
  files = { "src/config.ts": "line one\nline two\n  const timeout = 30\nline four\n" }
})
afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

describe("review_list", () => {
  test("says plainly when there is nothing, rather than returning an empty list", async () => {
    expect((await run("review_list", {})).toLowerCase()).toContain("no review comments")
  })

  test("describes a thread well enough to answer it without another call", async () => {
    await store().save(thread())
    const said = await run("review_list", {})
    expect(said).toContain("rv_000000001")
    expect(said).toContain("src/config.ts")
    expect(said).toContain("why thirty?")
    /** The code it was written against, so the agent is not answering blind. */
    expect(said).toContain("const timeout = 30")
  })

  test("waiting by default; resolved threads only when asked for", async () => {
    await store().save(thread())
    await store().save(thread({ id: "rv_000000002", file: "src/other.ts", status: "resolved" }))
    expect(await run("review_list", {})).not.toContain("rv_000000002")
    expect(await run("review_list", { status: "all" })).toContain("rv_000000002")
  })

  test("one file at a time, by suffix", async () => {
    await store().save(thread())
    await store().save(thread({ id: "rv_000000002", file: "src/other.ts" }))
    const said = await run("review_list", { file: "other.ts" })
    expect(said).toContain("rv_000000002")
    expect(said).not.toContain("rv_000000001")
  })

  /** A thread whose code moved on is worth flagging: the answer may be about code that is gone. */
  test("says when the code has changed since the comment was written", async () => {
    await store().save(thread())
    files["src/config.ts"] = "line one\nline two\n  const timeout = 5\nline four\n"
    expect(await run("review_list", {})).toContain("changed")
  })
})

describe("review_reply", () => {
  test("answers by id, and the thread is waiting on the person after", async () => {
    await store().save(thread())
    const said = await run("review_reply", { id: "rv_000000001", text: "Thirty is the gateway timeout." })
    expect(said).toContain("waiting on the person")
    const [saved] = await store().load()
    expect(saved?.status).toBe("answered")
    expect(saved?.entries.at(-1)).toMatchObject({ author: "agent", body: "Thirty is the gateway timeout." })
  })

  /** An agent that has just read `config.ts:41` should not have to carry an opaque id back. */
  test("answers by the file and line it has in hand", async () => {
    await store().save(thread({ line: 2, through: 4 }))
    await run("review_reply", { file: "config.ts", line: 3, text: "Fixed." })
    expect((await store().load())[0]?.entries).toHaveLength(2)
  })

  test("asks which one, rather than guessing, when a file and line match two", async () => {
    await store().save(thread())
    await store().save(thread({ id: "rv_000000002" }))
    const said = await run("review_reply", { file: "config.ts", line: 3, text: "Fixed." })
    expect(said).toContain("matches 2 threads")
    expect(said).toContain("rv_000000002")
    /** And nothing was written: an ambiguous answer is not an answer. */
    expect((await store().load()).every((each) => each.entries.length === 1)).toBe(true)
  })

  test("says what is waiting when nothing matches", async () => {
    await store().save(thread())
    const said = await run("review_reply", { id: "rv_nope", text: "Fixed." })
    expect(said).toContain("No thread matches")
    expect(said).toContain("rv_000000001")
  })

  describe("resolving", () => {
    test("holds when the code it was written against has changed", async () => {
      await store().save(thread())
      files["src/config.ts"] = "line one\nline two\n  const timeout = 5\nline four\n"
      const said = await run("review_reply", { id: "rv_000000001", text: "Now five.", resolved: true })
      expect(said).toContain("Resolved")
      expect((await store().load())[0]?.status).toBe("resolved")
    })

    /**
     * The check that makes the loop trustworthy: an agent told "done" over an untouched file learns
     * nothing, and the person would have found out by reading.
     */
    test("does not hold when the file still reads exactly as it did", async () => {
      await store().save(thread())
      const said = await run("review_reply", { id: "rv_000000001", text: "Done!", resolved: true })
      expect(said).toContain("not resolved")
      expect(said).toContain("nothing was changed")
      const [saved] = await store().load()
      expect(saved?.status).toBe("answered")
      /** The reply is kept. It is an answer, just not a finished one. */
      expect(saved?.entries.at(-1)?.body).toBe("Done!")
    })
  })
})

describe("review_open", () => {
  test("leaves a note on a line, with the code it is about", async () => {
    const said = await run("review_open", {
      file: "src/config.ts",
      line: 3,
      text: "This retries forever if the host is down.",
    })
    expect(said).toContain("line 3")
    const [saved] = await store().load()
    expect(saved?.file).toBe("src/config.ts")
    expect(saved?.quoted).toEqual(["  const timeout = 30"])
    expect(saved?.entries[0]).toMatchObject({ author: "agent" })
  })

  /**
   * A note the agent leaves is waiting on the person, exactly as a reply from it would be — or its
   * own notes come back round to it as work it is waiting on, including in a submit.
   */
  test("is waiting on the person, not on itself", async () => {
    await run("review_open", { file: "src/config.ts", line: 3, text: "Worth a test." })
    expect((await store().load())[0]?.status).toBe("answered")
  })

  test("a range keeps every line of it", async () => {
    await run("review_open", { file: "src/config.ts", from: 1, to: 3, text: "This block is doing two jobs." })
    const [saved] = await store().load()
    expect(saved?.line).toBe(1)
    expect(saved?.through).toBe(3)
    expect(saved?.quoted).toHaveLength(3)
  })

  test("a note about the whole file names no line", async () => {
    await run("review_open", { file: "src/config.ts", text: "This file is doing two jobs." })
    const [saved] = await store().load()
    expect(saved?.line).toBeUndefined()
    expect(saved?.quoted).toBeUndefined()
  })

  test("says so rather than inventing a file it cannot find", async () => {
    const said = await run("review_open", { file: "nowhere.ts", line: 1, text: "..." })
    expect(said).toContain("No file matches")
    expect(await store().load()).toHaveLength(0)
  })

  /**
   * A path the host cannot resolve is refused rather than filed as typed. A thread under `config.ts`
   * when the diff says `src/config.ts` is a note the panel will never show.
   */
  test("a bare name the host cannot resolve is refused, not guessed at", async () => {
    expect(await run("review_open", { file: "config.ts", line: 3, text: "..." })).toContain("No file matches")
    expect(await store().load()).toHaveLength(0)
  })

  /** Unless the person already filed one there — then the full path is known, and a suffix is enough. */
  test("but a file the person has already commented on is found by suffix", async () => {
    await store().save(thread({ line: 1 }))
    await run("review_open", { file: "config.ts", line: 3, text: "Also worth a test." })
    const saved = await store().load()
    expect(saved).toHaveLength(2)
    expect(saved[1]?.file).toBe("src/config.ts")
  })

  /**
   * A second thing said about lines that already have a thread continues that thread rather than
   * starting a rival beside it — and the tool has to save *that* thread, wherever it sits in the list.
   */
  test("a note on lines that already have a thread continues it", async () => {
    await store().save(thread({ id: "rv_000000001", file: "src/other.ts", line: 1 }))
    await store().save(thread({ id: "rv_000000002" }))
    const said = await run("review_open", { file: "src/config.ts", line: 3, text: "Still true." })
    expect(said).toContain("Added to rv_000000002")
    const saved = await store().load()
    expect(saved).toHaveLength(2)
    expect(saved.find((each) => each.id === "rv_000000002")?.entries).toHaveLength(2)
  })

  /** The panel and the tools share one directory: a note either side leaves is a note the other reads. */
  test("writes where the panel reads", async () => {
    await run("review_open", { file: "src/config.ts", line: 3, text: "Worth a test." })
    const said = await run("review_list", { status: "all" })
    expect(said).toContain("Worth a test.")
  })
})
