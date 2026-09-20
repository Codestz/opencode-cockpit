import { describe, expect, test } from "bun:test"
import {
  addNote,
  type ChangeSet,
  emptyReview,
  type FileChange,
  hasSomethingToSay,
  isRead,
  type Note,
  nextUnread,
  noteIsStale,
  noteRange,
  notesFor,
  notesOnLine,
  progress,
  type Review,
  removeNote,
  toggleRead,
} from "../../src/core/model/review.ts"

/**
 * The rules a reviewer feels but never sees: that a second thought replaces the first, that marking
 * a file read moves you on, that a note whose code has moved says so rather than lying about a line.
 */

const changes: ChangeSet = {
  source: "session",
  files: [
    { path: "a.ts", before: "one\ntwo\nthree\n", after: "one\nTWO\nthree\n", additions: 1, deletions: 1 },
    { path: "b.ts", before: "", after: "new\n", additions: 1, deletions: 0 },
    { path: "c.ts", before: "gone\n", after: "", additions: 0, deletions: 1 },
  ],
}

const note = (over: Partial<Note> = {}): Note => ({ file: "a.ts", line: 2, body: "why?", ...over })

describe("where a note attaches", () => {
  test("one line is a range of one", () => {
    expect(noteRange(note())).toEqual({ from: 2, to: 2 })
  })

  test("a range covers what it was given, and never runs backwards", () => {
    expect(noteRange(note({ line: 2, through: 5 }))).toEqual({ from: 2, to: 5 })
    expect(noteRange(note({ line: 5, through: 2 }))).toEqual({ from: 5, to: 5 })
  })

  test("a note about the whole file has no range", () => {
    expect(noteRange(note({ line: undefined }))).toBeUndefined()
  })
})

describe("adding and removing notes", () => {
  test("a second note on the same line replaces the first", () => {
    // Otherwise a corrected thought is submitted alongside the thought it corrected.
    const once = addNote(emptyReview(), note({ body: "first" }))
    const twice = addNote(once, note({ body: "second" }))
    expect(twice.notes).toHaveLength(1)
    expect(twice.notes[0]?.body).toBe("second")
  })

  test("a note on a different line is kept alongside", () => {
    const review = addNote(addNote(emptyReview(), note({ line: 2 })), note({ line: 3 }))
    expect(review.notes).toHaveLength(2)
  })

  test("the same line in a different file is a different note", () => {
    const review = addNote(addNote(emptyReview(), note()), note({ file: "b.ts" }))
    expect(review.notes).toHaveLength(2)
  })

  test("a range note and a single-line note starting there are different notes", () => {
    const review = addNote(addNote(emptyReview(), note({ line: 2 })), note({ line: 2, through: 4 }))
    expect(review.notes).toHaveLength(2)
  })

  test("a file-level note replaces another file-level note on the same file", () => {
    const review = addNote(
      addNote(emptyReview(), note({ line: undefined, body: "one" })),
      note({ line: undefined, body: "two" }),
    )
    expect(review.notes).toHaveLength(1)
    expect(review.notes[0]?.body).toBe("two")
  })

  test("removing takes only the note asked for", () => {
    const review = addNote(addNote(emptyReview(), note({ line: 2 })), note({ line: 3 }))
    expect(removeNote(review, "a.ts", 2).notes.map((n) => n.line)).toEqual([3])
  })

  test("notes come back in line order however they were added", () => {
    const review = addNote(
      addNote(addNote(emptyReview(), note({ line: 9 })), note({ line: 2 })),
      note({ line: 5 }),
    )
    expect(notesFor(review, "a.ts").map((n) => n.line)).toEqual([2, 5, 9])
  })

  test("a note is found under the first line of its range, not the last", () => {
    const review = addNote(emptyReview(), note({ line: 2, through: 6 }))
    expect(notesOnLine(review, "a.ts", 2)).toHaveLength(1)
    expect(notesOnLine(review, "a.ts", 6)).toHaveLength(0)
  })
})

describe("a note whose code has moved", () => {
  const file = changes.files[0] as FileChange

  test("is stale when the quoted line no longer reads that way", () => {
    expect(noteIsStale(note({ line: 2, quoted: ["something else"] }), file)).toBe(true)
  })

  test("is not stale when it still matches", () => {
    expect(noteIsStale(note({ line: 2, quoted: ["TWO"] }), file)).toBe(false)
  })

  test("a note that quoted nothing cannot be stale", () => {
    // Nothing to compare against is not evidence of a move, and a false mark costs trust.
    expect(noteIsStale(note({ line: 2 }), file)).toBe(false)
  })

  test("a multi-line quote has to match all the way down", () => {
    expect(noteIsStale(note({ line: 1, through: 2, quoted: ["one", "TWO"] }), file)).toBe(false)
    expect(noteIsStale(note({ line: 1, through: 2, quoted: ["one", "two"] }), file)).toBe(true)
  })

  test("a file that is no longer in the change set is not called stale", () => {
    expect(noteIsStale(note({ quoted: ["TWO"] }), undefined)).toBe(false)
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
    const review = toggleRead(emptyReview(), "c.ts")
    expect(nextUnread(changes, review, "c.ts")).toBe("a.ts")
  })

  test("it skips files already read", () => {
    const review = toggleRead(emptyReview(), "b.ts")
    expect(nextUnread(changes, review, "a.ts")).toBe("c.ts")
  })

  test("everything read means there is nowhere to go", () => {
    const all = changes.files.reduce((review, file) => toggleRead(review, file.path), emptyReview())
    expect(nextUnread(changes, all, "a.ts")).toBeUndefined()
  })
})

describe("progress", () => {
  test("counts files, reads, notes and the totals", () => {
    const review = addNote(toggleRead(emptyReview(), "a.ts"), note())
    expect(progress(changes, review)).toEqual({
      files: 3,
      read: 1,
      notes: 1,
      additions: 2,
      deletions: 2,
    })
  })

  test("an empty change set counts zero rather than failing", () => {
    expect(progress({ source: "session", files: [] }, emptyReview()).files).toBe(0)
  })
})

describe("whether there is anything to send", () => {
  /** An empty review posted to the chat is exactly the interruption this bay exists to prevent. */
  test("a review with no notes and no summary has nothing to say", () => {
    expect(hasSomethingToSay(emptyReview())).toBe(false)
  })

  test("a summary of only whitespace still has nothing to say", () => {
    expect(hasSomethingToSay({ ...emptyReview(), summary: "   \n " })).toBe(false)
  })

  test("one note is enough", () => {
    expect(hasSomethingToSay(addNote(emptyReview(), note()))).toBe(true)
  })

  test("a summary on its own is enough — approving without comments is a review", () => {
    const review: Review = { ...emptyReview(), summary: "looks right, ship it" }
    expect(hasSomethingToSay(review)).toBe(true)
  })
})
