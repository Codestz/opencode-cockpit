import { describe, expect, test } from "bun:test"
import { emptyReview, open, say } from "../../src/core/model/review.ts"
import { createQueries } from "../../src/tui/panel/queries.ts"

/**
 * The thread under the cursor is the one drawn there.
 *
 * A thread is drawn where its code reads now; it used to be looked up where it was first written.
 * Once the code moved — the agent answering usually moves it — `c` on the thread found nothing,
 * opened a second thread, and that one sorted above the conversation it was meant to continue.
 */
describe("the thread under the cursor", () => {
  const before = "one\ntwo\nthree\nfour\n"
  /** Two lines added above: the commented line `two` is now line 4. */
  const after = "zero\nhalf\none\ntwo\nthree\nfour\n"
  const store = {
    current: () => ({
      changes: { source: "worktree", files: [{ path: "a.ts", before, after, additions: 2, deletions: 0 }] },
    }),
    source: () => "worktree",
  }
  const api = { state: { vcs: { branch: "main" } } }
  const written = open(emptyReview(), { file: "a.ts", line: 2, quoted: ["two"] }, "why two?")
  const id = written.threads[0]?.id as string
  const answered = say(written, id, { author: "agent", body: "because", at: 2 })

  const here = (line: number) =>
    createQueries(
      api as never,
      { view: { file: "a.ts", pane: "diff", line }, review: answered } as never,
      store as never,
    )

  test("is found on the line it is drawn on now, after its code moved", () => {
    expect(here(4).reachableThreadId()).toBe(id)
  })

  test("and not on the line it was first written on", () => {
    expect(here(2).reachableThreadId()).toBeUndefined()
  })
})
