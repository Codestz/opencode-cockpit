/**
 * A note, once the agent can answer it.
 *
 * The first version of a note was a sentence you wrote and forgot: one body, one author, no state.
 * That stops working the moment something replies — a review is then a set of small conversations
 * anchored to lines, each of which is waiting on somebody.
 *
 * Kept apart from the terminal and from OpenCode so the rules — who is waiting, when a resolve is
 * believable, what counts as finished — can be tested as functions of plain data.
 */

/** Who said a thing. Not a name: there are exactly two parties and that is unlikely to change. */
export type Author = "you" | "agent"

export interface Entry {
  author: Author
  body: string
  /** Epoch milliseconds, so a thread can be read in the order it happened. */
  at: number
}

/**
 * Where a thread stands.
 *
 * - `open` — said, and not yet answered. Waiting on the agent.
 * - `answered` — the agent replied without changing anything, or its resolve did not hold up.
 *   Waiting on you.
 * - `resolved` — the agent says it acted, and the code agrees. Waiting on nobody.
 */
export type Status = "open" | "answered" | "resolved"

export interface Thread {
  id: string
  file: string
  /** Absent for a thread about the file as a whole. */
  line?: number
  /** Set when it covers a range; `line` is its first line. */
  through?: number
  /**
   * The lines as they read when the thread was opened.
   *
   * Two jobs: a thread whose code has moved can say so instead of citing a line that no longer means
   * anything, and a resolve can be checked against it rather than taken on trust.
   */
  quoted?: string[]
  /**
   * The commit the file was at when this was written.
   *
   * Provenance, not an anchor: a comment is *found* by its quoted lines, because that is what
   * survives being committed. This is for saying "written against a1b2c3" and for telling two
   * reviews of the same lines apart.
   */
  commit?: string
  entries: Entry[]
  status: Status
}

/** Ids are short, sortable by age, and readable aloud when something goes wrong. */
export function threadId(at: number = Date.now()): string {
  /**
   * The timestamp is padded to a fixed width because base-36 numbers of different lengths do not sort
   * as strings — `rs` (1,000) would come after `1jk` (2,000), and a review would read out of order
   * for no reason anyone could see.
   */
  const when = at.toString(36).padStart(9, "0")
  const salt = Math.floor(Math.random() * 1296)
    .toString(36)
    .padStart(2, "0")
  return `rv_${when}${salt}`
}

export interface Range {
  /** 1-based, inclusive, in the new file. */
  from: number
  to: number
}

/** A thread's lines in the new file, whether it covers one line or several. */
export function threadRange(thread: Pick<Thread, "line" | "through">): Range | undefined {
  if (thread.line === undefined) return undefined
  return { from: thread.line, to: Math.max(thread.line, thread.through ?? thread.line) }
}

/** What a thread is about, in words, for a heading. */
export function threadWhere(thread: Pick<Thread, "line" | "through">): string {
  const range = threadRange(thread)
  if (!range) return "whole file"
  return range.to > range.from ? `lines ${range.from}–${range.to}` : `line ${range.from}`
}

/** The first thing said. There is always one: a thread with nothing in it is not a thread. */
export const opening = (thread: Thread): Entry | undefined => thread.entries[0]

/** The last thing said, which is what a collapsed thread shows and who is waiting is derived from. */
export const latest = (thread: Thread): Entry | undefined => thread.entries.at(-1)

/** Who the thread is waiting on, which is the only thing a reader wants from its status. */
export function waitingOn(thread: Thread): Author | undefined {
  if (thread.status === "resolved") return undefined
  return thread.status === "answered" ? "you" : "agent"
}

/** Says a thing on a thread. Answering moves it to whoever did not speak last. */
export function reply(thread: Thread, entry: Entry): Thread {
  return {
    ...thread,
    entries: [...thread.entries, entry],
    status: entry.author === "agent" ? "answered" : "open",
  }
}

/**
 * Whether the code a thread was opened against still reads the way it did.
 *
 * Not deleted when it moves — the reviewer meant it — but marked, so nobody trusts the number.
 */
/**
 * Where a thread's code is now — which is not always where it was, and is sometimes nowhere.
 *
 * Three answers rather than two, because "the lines moved" and "the lines are gone" want opposite
 * treatment. Code that moved should take its comment with it, silently: an edit above a thread is
 * not a reason to make the thread look broken. Code that is gone should say so, and stop being
 * handed to an agent as work — an answer about lines that no longer exist answers nothing.
 *
 * Content is the anchor, not a commit. A comment survives being committed because committing does
 * not change the code, only where git keeps it; anchoring to a commit would orphan every comment on
 * the branch at the moment you committed, which is the failure it was meant to prevent.
 */
export type Anchor =
  | { state: "current" }
  /** The quoted lines are still in the file, starting here instead. */
  | { state: "moved"; line: number; through?: number }
  /** The quoted lines are not in the file at all. */
  | { state: "outdated" }

export function anchorOf(thread: Thread, after: string | undefined): Anchor {
  const range = threadRange(thread)
  /** Nothing to check against: a note on the whole file, or a file we cannot read, is never stale. */
  if (!thread.quoted?.length || !range || after === undefined) return { state: "current" }

  const lines = after.split("\n")
  const here = thread.quoted.every((text, index) => lines[range.from - 1 + index] === text)
  if (here) return { state: "current" }

  /**
   * The same block, elsewhere. Searched as a whole rather than line by line: a single line of
   * `  }` matches in fifty places, and a comment that re-anchors to the wrong one is worse than a
   * comment that admits it is lost.
   */
  const quoted = thread.quoted
  for (let at = 0; at + quoted.length <= lines.length; at++) {
    if (quoted.every((text, index) => lines[at + index] === text)) {
      const line = at + 1
      const span = quoted.length - 1
      return span > 0 ? { state: "moved", line, through: line + span } : { state: "moved", line }
    }
  }
  return { state: "outdated" }
}

/** Whether the code a thread is about has changed under it, either way. */
export function hasDrifted(thread: Thread, after: string | undefined): boolean {
  return anchorOf(thread, after).state !== "current"
}

/** Where the thread should be drawn now: its anchored range, or the one it was written against. */
export function anchoredRange(thread: Thread, after: string | undefined): Range | undefined {
  const anchor = anchorOf(thread, after)
  if (anchor.state !== "moved") return threadRange(thread)
  return { from: anchor.line, to: anchor.through ?? anchor.line }
}

/**
 * Closing a thread, checked rather than trusted.
 *
 * Resolving claims the code changed, and that claim is checkable: a thread quotes the lines it was
 * opened against, so if they are byte-identical nothing was done. The reply is kept — the agent said
 * something and that is worth reading — but the thread stays open on the person's side as an answer.
 *
 * This is what lets `resolved` be an ordinary flag on a reply instead of a privileged operation.
 */
export function resolve(thread: Thread, entry: Entry, after: string | undefined): Thread {
  const said = reply(thread, entry)
  const changed = hasDrifted(thread, after) || thread.quoted === undefined
  return { ...said, status: changed ? "resolved" : "answered" }
}

/** Reopening, for when the agent was wrong or you changed your mind. */
export const reopen = (thread: Thread): Thread => ({ ...thread, status: "open" })

export interface Tally {
  open: number
  answered: number
  resolved: number
}

export function tally(threads: readonly Thread[]): Tally {
  return {
    open: threads.filter((thread) => thread.status === "open").length,
    answered: threads.filter((thread) => thread.status === "answered").length,
    resolved: threads.filter((thread) => thread.status === "resolved").length,
  }
}

/**
 * One thread, as prose anybody can read without another call.
 *
 * Used by `review_list` to describe what is waiting, and by submit to carry the whole review as text
 * when the agent has no tools to fetch it with. Both are the same job — saying what a thread is — and
 * two versions of it would drift into disagreeing about what a thread is.
 */
export function describeThread(thread: Thread, after?: string | undefined): string {
  const waiting = waitingOn(thread)
  const state = thread.status === "resolved" ? "resolved" : `${thread.status}, waiting on ${waiting}`
  const anchor = anchorOf(thread, after)
  /**
   * Said differently for the two, because they ask for different things.
   *
   * Moved: the code is still there, at a line the agent should use instead of the one recorded.
   * Outdated: the code is gone, and the only honest answer is to say so rather than to invent one.
   */
  const drifted =
    anchor.state === "moved"
      ? ` · moved, now at line ${anchor.line}`
      : anchor.state === "outdated"
        ? " · OUTDATED: the lines it was written against are no longer in the file"
        : ""
  const said = thread.entries.map((entry) => `    ${entry.author}: ${entry.body}`).join("\n")
  const quoted = thread.quoted?.length
    ? `\n  code as it was:\n${thread.quoted.map((line) => `    ${line}`).join("\n")}`
    : ""
  return `${thread.id}  ${thread.file} · ${threadWhere(thread)}  [${state}${drifted}]\n${said}${quoted}`
}
