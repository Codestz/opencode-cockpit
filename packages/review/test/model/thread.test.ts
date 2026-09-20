import { describe, expect, test } from "bun:test"
import {
  type Entry,
  hasDrifted,
  latest,
  reopen,
  reply,
  resolve,
  type Thread,
  tally,
  threadId,
  threadRange,
  threadWhere,
  waitingOn,
} from "../../src/core/model/thread.ts"

/**
 * The rules a reviewer feels but never sees: who a thread is waiting on, when a resolve is believable,
 * and what happens to a note whose code has moved out from under it.
 */

const said = (body: string, author: Entry["author"] = "you", at = 1): Entry => ({ author, body, at })

const thread = (over: Partial<Thread> = {}): Thread => ({
  id: "rv_1",
  file: "a.ts",
  line: 2,
  quoted: ["TWO"],
  entries: [said("why?")],
  status: "open",
  ...over,
})

describe("where a thread attaches", () => {
  test("one line is a range of one", () => {
    expect(threadRange(thread())).toEqual({ from: 2, to: 2 })
  })

  test("a range covers what it was given, and never runs backwards", () => {
    expect(threadRange({ line: 2, through: 5 })).toEqual({ from: 2, to: 5 })
    expect(threadRange({ line: 5, through: 2 })).toEqual({ from: 5, to: 5 })
  })

  test("a thread about the whole file has no range, and says so in words", () => {
    expect(threadRange({})).toBeUndefined()
    expect(threadWhere({})).toBe("whole file")
    expect(threadWhere({ line: 4 })).toBe("line 4")
    expect(threadWhere({ line: 4, through: 9 })).toBe("lines 4–9")
  })
})

describe("who is waiting", () => {
  test("a thread just opened is waiting on the agent", () => {
    expect(waitingOn(thread())).toBe("agent")
  })

  test("once the agent has answered it is waiting on you", () => {
    expect(waitingOn(reply(thread(), said("no, because", "agent", 2)))).toBe("you")
  })

  test("your reply hands it back", () => {
    const answered = reply(thread(), said("no, because", "agent", 2))
    expect(waitingOn(reply(answered, said("still wrong", "you", 3)))).toBe("agent")
  })

  test("a resolved thread is waiting on nobody", () => {
    expect(waitingOn(thread({ status: "resolved" }))).toBeUndefined()
  })
})

describe("resolving is checked, not trusted", () => {
  /**
   * Resolving claims the code changed, and the claim is checkable: a thread quotes the lines it was
   * opened against. This is what lets `resolved` be an ordinary flag on a reply rather than a
   * privileged operation.
   */
  test("holds when the quoted code has changed", () => {
    const done = resolve(thread(), said("fixed", "agent", 2), "one\nCHANGED\nthree\n")
    expect(done.status).toBe("resolved")
  })

  test("becomes an answer when the code is untouched", () => {
    const done = resolve(thread(), said("fixed", "agent", 2), "one\nTWO\nthree\n")
    expect(done.status).toBe("answered")
    /** The reply is kept: the agent said something and that is worth reading. */
    expect(latest(done)?.body).toBe("fixed")
  })

  test("a thread that quoted nothing is taken at its word", () => {
    // Nothing to check against is not evidence of a lie, and refusing every such resolve would make
    // file-level threads impossible to close.
    const done = resolve(thread({ quoted: undefined }), said("fixed", "agent", 2), "unchanged\n")
    expect(done.status).toBe("resolved")
  })

  test("reopening puts it back on the agent", () => {
    expect(waitingOn(reopen(thread({ status: "resolved" })))).toBe("agent")
  })
})

describe("a thread whose code has moved", () => {
  const after = "one\nTWO\nthree\n"

  test("has drifted when the quoted line no longer reads that way", () => {
    expect(hasDrifted(thread({ quoted: ["something else"] }), after)).toBe(true)
  })

  test("has not drifted when it still matches", () => {
    expect(hasDrifted(thread(), after)).toBe(false)
  })

  test("a multi-line quote has to match all the way down", () => {
    expect(hasDrifted(thread({ line: 1, through: 2, quoted: ["one", "TWO"] }), after)).toBe(false)
    expect(hasDrifted(thread({ line: 1, through: 2, quoted: ["one", "two"] }), after)).toBe(true)
  })

  test("a thread that quoted nothing cannot have drifted", () => {
    // A false mark costs trust, and nothing to compare against is not evidence of a move.
    expect(hasDrifted(thread({ quoted: undefined }), after)).toBe(false)
  })
})

describe("counting", () => {
  test("says how many are open, answered and done", () => {
    expect(
      tally([thread(), thread({ status: "answered" }), thread({ status: "resolved" }), thread()]),
    ).toEqual({ open: 2, answered: 1, resolved: 1 })
  })
})

describe("ids", () => {
  test("sort by age, so a review reads in the order it happened", () => {
    expect(threadId(1_000) < threadId(2_000)).toBe(true)
  })

  test("two opened in the same millisecond are still different", () => {
    const ids = new Set(Array.from({ length: 50 }, () => threadId(1_000)))
    expect(ids.size).toBeGreaterThan(1)
  })
})
