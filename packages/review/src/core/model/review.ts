/**
 * What a review is, as data.
 *
 * Kept apart from both OpenCode and the terminal so the rules — where a thread attaches, when it has
 * drifted, what counts as read — can be tested without either. The drawing code holds no state of its
 * own; it renders one of these and calls one of these functions.
 */

import {
  type Anchor,
  type Author,
  anchoredRange,
  anchorOf,
  type Entry,
  hasDrifted,
  reply,
  type Thread,
  threadId,
  threadRange,
} from "./thread.ts"

export type { Anchor, Author, Entry, Range, Thread } from "./thread.ts"

/** Worktree: what is uncommitted. Branch: what this branch changes against its base. */
export type Source = "worktree" | "branch"

export interface FileChange {
  path: string
  before: string
  after: string
  additions: number
  deletions: number
}

export interface ChangeSet {
  source: Source
  files: FileChange[]
}

export interface Review {
  threads: Thread[]
  /** Paths marked read. */
  read: string[]
  /** The sentence at the top of the submitted message. */
  summary?: string
}

export const emptyReview = (): Review => ({ threads: [], read: [] })

/** Opening a thread: the first thing said, on the lines it is about. */
export function open(
  review: Review,
  where: { file: string; line?: number; through?: number; quoted?: string[]; commit?: string },
  body: string,
  author: Author = "you",
  at: number = Date.now(),
): Review {
  const thread: Thread = {
    id: threadId(at),
    file: where.file,
    ...(where.line === undefined ? {} : { line: where.line }),
    ...(where.through === undefined ? {} : { through: where.through }),
    ...(where.quoted === undefined ? {} : { quoted: where.quoted }),
    ...(where.commit === undefined ? {} : { commit: where.commit }),
    entries: [{ author, body, at }],
    /**
     * A note the agent leaves is waiting on the *person*, exactly as a reply from it would be.
     *
     * Hardcoding "open" here predated the agent being able to open threads at all, and it meant its
     * own notes came back round to it as work it was waiting on — including in a submit.
     */
    status: author === "agent" ? "answered" : "open",
  }
  /** A second thought about the same lines continues the thread rather than starting a rival one. */
  const existing = at ? threadOn(review, thread.file, thread.line, thread.through) : undefined
  if (existing) return say(review, existing.id, { author, body, at })
  return { ...review, threads: [...review.threads, thread] }
}

/** Says something on an existing thread. */
export function say(review: Review, id: string, entry: Entry): Review {
  return {
    ...review,
    threads: review.threads.map((thread) => (thread.id === id ? reply(thread, entry) : thread)),
  }
}

/** Replaces a thread wholesale — how resolving and reopening are applied. */
export function put(review: Review, thread: Thread): Review {
  return { ...review, threads: review.threads.map((each) => (each.id === thread.id ? thread : each)) }
}

export function drop(review: Review, id: string): Review {
  return { ...review, threads: review.threads.filter((thread) => thread.id !== id) }
}

export function threadById(review: Review, id: string): Thread | undefined {
  return review.threads.find((thread) => thread.id === id)
}

/** The thread already covering exactly these lines of this file, if there is one. */
export function threadOn(review: Review, file: string, line?: number, through?: number): Thread | undefined {
  const wanted = threadRange({ line, through })
  return review.threads.find((thread) => {
    if (thread.file !== file) return false
    const theirs = threadRange(thread)
    if (!wanted || !theirs) return wanted === theirs
    return theirs.from === wanted.from && theirs.to === wanted.to
  })
}

export function threadsFor(review: Review, file: string): Thread[] {
  return review.threads.filter((thread) => thread.file === file).sort((a, b) => (a.line ?? 0) - (b.line ?? 0))
}

/**
 * The threads to draw under one line of the new file.
 *
 * A thread about a range belongs under the *last* line it covers: you select thirteen through fifteen
 * and it is about all three, so it reads after them — which is where a pull request puts it, and
 * where the eye goes looking.
 */
/**
 * The threads that read after this line.
 *
 * Anchored rather than remembered: a thread whose code moved is drawn where the code is now, so an
 * edit above a comment carries the comment down with it instead of stranding it. A thread whose code
 * is gone keeps the line it was written against — there is nowhere better to put it, and it says so.
 */
export function threadsOnLine(review: Review, file: string, line: number, after?: string): Thread[] {
  return threadsFor(review, file).filter((thread) => anchoredRange(thread, after)?.to === line)
}

/**
 * Files with comments on them that this view does not contain.
 *
 * Commit the work you were reviewing and the worktree diff empties: the comments are still true and
 * still on disk, but there is no file in front of you to draw them against. They are not lost and
 * they are not stale — they are somewhere else, usually one source away, and the panel says so
 * rather than silently dropping them.
 */
export function filesElsewhere(review: Review, changes: ChangeSet): string[] {
  const shown = new Set(changes.files.map((file) => file.path))
  const missing = review.threads.filter((thread) => !shown.has(thread.file)).map((thread) => thread.file)
  return [...new Set(missing)].sort()
}

/** Where a thread's code is now, given the file it belongs to. */
export function threadAnchor(thread: Thread, file: FileChange | undefined): Anchor {
  return anchorOf(thread, file?.after)
}

/** Whether a thread's code has changed under it, either way. */
export function threadDrifted(thread: Thread, file: FileChange | undefined): boolean {
  return hasDrifted(thread, file?.after)
}

export function toggleRead(review: Review, file: string): Review {
  const read = review.read.includes(file)
    ? review.read.filter((path) => path !== file)
    : [...review.read, file]
  return { ...review, read }
}

export function isRead(review: Review, file: string): boolean {
  return review.read.includes(file)
}

/**
 * The next file still to read, wrapping once. Marking a file read is meant to move you on; having to
 * find the next one yourself is the part that makes people stop doing it.
 */
export function nextUnread(changes: ChangeSet, review: Review, from: string | undefined): string | undefined {
  const paths = changes.files.map((file) => file.path)
  const start = from ? paths.indexOf(from) + 1 : 0
  const ordered = [...paths.slice(start), ...paths.slice(0, start)]
  return ordered.find((path) => !isRead(review, path))
}

export interface Progress {
  files: number
  read: number
  threads: number
  open: number
  additions: number
  deletions: number
}

export function progress(changes: ChangeSet, review: Review): Progress {
  return {
    files: changes.files.length,
    read: changes.files.filter((file) => isRead(review, file.path)).length,
    threads: review.threads.length,
    open: review.threads.filter((thread) => thread.status !== "resolved").length,
    additions: changes.files.reduce((sum, file) => sum + file.additions, 0),
    deletions: changes.files.reduce((sum, file) => sum + file.deletions, 0),
  }
}

/**
 * A review with nothing in it should not be sendable: an empty message in the chat is an interruption
 * that says nothing, which is the exact thing this bay exists to stop.
 */
export function hasSomethingToSay(review: Review): boolean {
  return review.threads.length > 0 || (review.summary?.trim().length ?? 0) > 0
}
