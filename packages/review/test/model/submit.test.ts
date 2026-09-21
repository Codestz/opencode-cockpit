import { describe, expect, test } from "bun:test"
import { emptyReview, open, type Review, say } from "../../src/core/model/review.ts"
import { submission, waitingOnAgent } from "../../src/core/model/submit.ts"

/**
 * Submit is the moment the review stops being a notepad. Before it existed, every note dialog ended
 * with "nothing is sent until you submit the review" and nothing could be submitted.
 */

const reviewWith = (howMany: number): Review => {
  let review = emptyReview()
  for (let index = 0; index < howMany; index++) {
    review = open(
      review,
      { file: `src/thing-${index}.ts`, line: index + 1, quoted: [`const thing${index} = true`] },
      `what about thing ${index}?`,
      "you",
      index + 1,
    )
  }
  return review
}

describe("what a submit is about", () => {
  test("the threads waiting on the agent, and only those", () => {
    let review = reviewWith(3)
    /** Answered by the agent: it is your turn, so it is not something to hand over again. */
    review = say(review, review.threads[0]?.id as string, {
      author: "agent",
      body: "done",
      at: 9,
    })
    expect(waitingOnAgent(review)).toHaveLength(2)
    expect(submission(review, { tools: true })?.threads).toHaveLength(2)
  })

  /** Sending "0 comments" would be asking the agent to go and look at an empty list. */
  test("nothing waiting is nothing to send", () => {
    expect(submission(emptyReview(), { tools: true })).toBeUndefined()
    let review = reviewWith(1)
    review = say(review, review.threads[0]?.id as string, { author: "agent", body: "done", at: 9 })
    expect(submission(review, { tools: true })).toBeUndefined()
  })

  test("says how many, and what they are about", () => {
    const said = submission(reviewWith(2), { tools: true, label: "feat/review-bay → main" })?.text as string
    expect(said).toContain("2 comments")
    expect(said).toContain("feat/review-bay → main")
  })

  test("one comment is one comment, not 1 comments", () => {
    expect(submission(reviewWith(1), { tools: true })?.text).toContain("1 comment.")
  })
})

describe("with the tools", () => {
  const said = () => submission(reviewWith(2), { tools: true })?.text as string

  /** The notes travel as data. A chat message the agent has to parse back into threads is neither. */
  test("names the tools instead of carrying the notes", () => {
    expect(said()).toContain("review_list")
    expect(said()).toContain("review_reply")
    expect(said()).not.toContain("what about thing 0?")
  })

  test("asks for the work, not just the reading", () => {
    expect(said()).toContain("resolved=true")
  })
})

describe("without them", () => {
  const said = () => submission(reviewWith(2), { tools: false })?.text as string

  /**
   * A TUI-only install has no `review_list`, so the review goes in the message. The loop degrades to
   * a one-shot review rather than leaving a comment nobody will ever read.
   */
  test("carries the whole review as prose", () => {
    expect(said()).toContain("what about thing 0?")
    expect(said()).toContain("what about thing 1?")
    expect(said()).not.toContain("review_list")
  })

  test("with the code each thread was written against", () => {
    expect(said()).toContain("const thing0 = true")
  })

  test("and the ids, because they are still the ids on disk", () => {
    const review = reviewWith(1)
    expect(submission(review, { tools: false })?.text).toContain(review.threads[0]?.id as string)
  })
})

describe("what the person wrote", () => {
  test("leads, because it is the only part a human wrote", () => {
    const said = submission(reviewWith(1), { tools: true, summary: "mostly naming, one real bug" })
      ?.text as string
    expect(said.startsWith("mostly naming, one real bug")).toBe(true)
  })

  test("is optional, and blank is not a line of its own", () => {
    const said = submission(reviewWith(1), { tools: true, summary: "   " })?.text as string
    expect(said.startsWith("I have left")).toBe(true)
  })
})

/**
 * The complaint that started this: comments about code that has already changed, handed over again
 * every time you submit. A thread whose quoted lines are gone is history, not work.
 */
describe("comments whose code is gone", () => {
  const onLine = (body: string, quoted: string[]) => {
    const review = open(emptyReview(), { file: "a.ts", line: 1, quoted }, body, "you", 1)
    return review
  }

  test("are held back, and counted", () => {
    const review = onLine("round this", ["const rate = 10"])
    const files = new Map([["a.ts", "const rate = 12\n"]])
    expect(submission(review, { tools: true, files })).toBeUndefined()

    const both = open(review, { file: "a.ts", line: 2, quoted: ["const other = 1"] }, "and this", "you", 2)
    const now = new Map([["a.ts", "const rate = 12\nconst other = 1\n"]])
    const said = submission(both, { tools: true, files: now })
    expect(said?.threads).toHaveLength(1)
    expect(said?.outdated).toHaveLength(1)
    /** And in the prose fallback, where the comments travel in the message, the held-back one is absent. */
    const written = submission(both, { tools: false, files: now })
    expect(written?.text).toContain("and this")
    expect(written?.text).not.toContain("round this")
  })

  test("code that merely moved is still work", () => {
    const review = onLine("round this", ["const rate = 10"])
    const files = new Map([["a.ts", "import x from 'y'\n\nconst rate = 10\n"]])
    expect(submission(review, { tools: true, files })?.threads).toHaveLength(1)
  })

  /** A submit that cannot see the files sends everything: silence is worse than too much. */
  test("without the files, nothing is held back", () => {
    const review = onLine("round this", ["const rate = 10"])
    expect(submission(review, { tools: true })?.threads).toHaveLength(1)
  })
})
