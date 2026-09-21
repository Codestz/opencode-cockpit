import { describe, expect, test } from "bun:test"
import {
  type ChangeSet,
  drop,
  emptyReview,
  hasSomethingToSay,
  isRead,
  nextUnread,
  open,
  progress,
  put,
  say,
  threadById,
  threadDrifted,
  threadOn,
  threadsFor,
  threadsOnLine,
  toggleRead,
} from "../../src/core/model/review.ts"
import { resolve } from "../../src/core/model/thread.ts"

const changes: ChangeSet = {
  source: "worktree",
  files: [
    { path: "a.ts", before: "one\ntwo\nthree\n", after: "one\nTWO\nthree\n", additions: 1, deletions: 1 },
    { path: "b.ts", before: "", after: "new\n", additions: 1, deletions: 0 },
    { path: "c.ts", before: "gone\n", after: "", additions: 0, deletions: 1 },
  ],
}

const a = () => changes.files[0]

describe("opening and continuing threads", () => {
  test("a second thought about the same lines continues the thread rather than starting a rival", () => {
    // Otherwise a corrected thought is submitted alongside the thought it corrected.
    const once = open(emptyReview(), { file: "a.ts", line: 2 }, "first", "you", 1)
    const twice = open(once, { file: "a.ts", line: 2 }, "second", "you", 2)
    expect(twice.threads).toHaveLength(1)
    expect(twice.threads[0]?.entries.map((entry) => entry.body)).toEqual(["first", "second"])
  })

  test("a different line is a different thread", () => {
    const review = open(open(emptyReview(), { file: "a.ts", line: 2 }, "x"), { file: "a.ts", line: 3 }, "y")
    expect(review.threads).toHaveLength(2)
  })

  test("the same line in a different file is a different thread", () => {
    const review = open(open(emptyReview(), { file: "a.ts", line: 2 }, "x"), { file: "b.ts", line: 2 }, "y")
    expect(review.threads).toHaveLength(2)
  })

  test("a range and a single line starting there are different threads", () => {
    const review = open(
      open(emptyReview(), { file: "a.ts", line: 2 }, "x"),
      { file: "a.ts", line: 2, through: 4 },
      "y",
    )
    expect(review.threads).toHaveLength(2)
  })

  test("threads come back in line order however they were opened", () => {
    let review = open(emptyReview(), { file: "a.ts", line: 9 }, "c")
    review = open(review, { file: "a.ts", line: 2 }, "a")
    review = open(review, { file: "a.ts", line: 5 }, "b")
    expect(threadsFor(review, "a.ts").map((thread) => thread.line)).toEqual([2, 5, 9])
  })

  test("dropping takes only the thread asked for", () => {
    const review = open(open(emptyReview(), { file: "a.ts", line: 2 }, "x"), { file: "a.ts", line: 3 }, "y")
    const id = threadOn(review, "a.ts", 2, 2)?.id as string
    expect(drop(review, id).threads.map((thread) => thread.line)).toEqual([3])
  })

  test("saying something on a thread keeps its id and appends", () => {
    const review = open(emptyReview(), { file: "a.ts", line: 2 }, "why?")
    const id = review.threads[0]?.id as string
    const answered = say(review, id, { author: "agent", body: "because", at: 2 })
    expect(threadById(answered, id)?.entries).toHaveLength(2)
    expect(threadById(answered, id)?.status).toBe("answered")
  })
})

describe("where a thread is drawn", () => {
  /**
   * A thread about a range reads *after* the lines it covers, which is where a pull request puts it
   * and where the eye goes looking. Under the first line it sits in the middle of its own subject.
   */
  test("a range thread is found under its last line, not its first", () => {
    const review = open(emptyReview(), { file: "a.ts", line: 2, through: 6 }, "all of it")
    expect(threadsOnLine(review, "a.ts", 6)).toHaveLength(1)
    expect(threadsOnLine(review, "a.ts", 2)).toHaveLength(0)
  })
})

describe("drift", () => {
  test("a thread whose quoted line no longer reads that way has drifted", () => {
    const review = open(emptyReview(), { file: "a.ts", line: 2, quoted: ["something else"] }, "x")
    expect(threadDrifted(review.threads[0] as never, a())).toBe(true)
  })

  test("one that still matches has not", () => {
    const review = open(emptyReview(), { file: "a.ts", line: 2, quoted: ["TWO"] }, "x")
    expect(threadDrifted(review.threads[0] as never, a())).toBe(false)
  })

  test("a file no longer in the change set is not called drifted", () => {
    const review = open(emptyReview(), { file: "a.ts", line: 2, quoted: ["TWO"] }, "x")
    expect(threadDrifted(review.threads[0] as never, undefined)).toBe(false)
  })
})

describe("read state", () => {
  test("toggles, and says so", () => {
    const read = toggleRead(emptyReview(), "a.ts")
    expect(isRead(read, "a.ts")).toBe(true)
    expect(isRead(toggleRead(read, "a.ts"), "a.ts")).toBe(false)
  })

  test("the next unread comes after the current file", () => {
    expect(nextUnread(changes, emptyReview(), "a.ts")).toBe("b.ts")
  })

  test("it wraps to the top rather than stopping at the end", () => {
    expect(nextUnread(changes, toggleRead(emptyReview(), "c.ts"), "c.ts")).toBe("a.ts")
  })

  test("it skips files already read", () => {
    expect(nextUnread(changes, toggleRead(emptyReview(), "b.ts"), "a.ts")).toBe("c.ts")
  })

  test("everything read means there is nowhere to go", () => {
    const all = changes.files.reduce((review, file) => toggleRead(review, file.path), emptyReview())
    expect(nextUnread(changes, all, "a.ts")).toBeUndefined()
  })
})

describe("progress", () => {
  test("counts files, reads, threads and what is still open", () => {
    let review = toggleRead(emptyReview(), "a.ts")
    review = open(review, { file: "a.ts", line: 2, quoted: ["TWO"] }, "one")
    review = open(review, { file: "b.ts", line: 1, quoted: ["new"] }, "two")
    const done = resolve(review.threads[0] as never, { author: "agent", body: "fixed", at: 9 }, "changed\n")
    review = put(review, done)

    expect(progress(changes, review)).toEqual({
      files: 3,
      read: 1,
      threads: 2,
      open: 1,
      additions: 2,
      deletions: 2,
    })
  })

  test("an empty change set counts zero rather than failing", () => {
    expect(progress({ source: "worktree", files: [] }, emptyReview()).files).toBe(0)
  })
})

describe("whether there is anything to send", () => {
  /** An empty review posted to the chat is exactly the interruption this bay exists to prevent. */
  test("no threads and no summary means nothing to say", () => {
    expect(hasSomethingToSay(emptyReview())).toBe(false)
  })

  test("a summary of only whitespace still has nothing to say", () => {
    expect(hasSomethingToSay({ ...emptyReview(), summary: "   \n " })).toBe(false)
  })

  test("one thread is enough", () => {
    expect(hasSomethingToSay(open(emptyReview(), { file: "a.ts", line: 1 }, "x"))).toBe(true)
  })

  test("a summary alone is enough — approving without comments is a review", () => {
    expect(hasSomethingToSay({ ...emptyReview(), summary: "looks right, ship it" })).toBe(true)
  })
})
