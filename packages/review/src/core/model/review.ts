/**
 * What a review is, as data.
 *
 * Kept apart from both OpenCode and the terminal so the rules — where a note attaches, when it goes
 * stale, what counts as read — can be tested without either. The drawing code holds no state of its
 * own; it renders one of these and calls one of these functions.
 */

/** Session: what this conversation changed. Worktree: what is uncommitted. Branch: vs its base. */
export type Source = "session" | "worktree" | "branch"

export interface Range {
  /** 1-based, inclusive, in the new file. */
  from: number
  to: number
}

export interface FileChange {
  path: string
  before: string
  after: string
  additions: number
  deletions: number
  /**
   * Line ranges this session wrote, for telling an agent's work from what was already on the
   * branch. Empty while the only source is the session — everything shown is the agent's. Branch
   * mode fills it, and nothing downstream changes when it does.
   */
  marked?: Range[]
}

export interface ChangeSet {
  source: Source
  files: FileChange[]
}

export interface Note {
  file: string
  /** Absent for a note about the file as a whole. */
  line?: number
  /** Set when the note covers a range; `line` is its first line. */
  through?: number
  body: string
  /** Offered instead of described: the replacement text for the lines the note covers. */
  suggestion?: string
  /**
   * The lines as they read when the note was written. Kept so a note still makes sense after a
   * later turn moves the code out from under it — a review that quotes the wrong line is worse
   * than one that admits the line has moved.
   */
  quoted?: string[]
}

export interface Review {
  notes: Note[]
  /** Paths marked read. */
  read: string[]
  /** The sentence at the top of the submitted message. */
  summary?: string
}

export const emptyReview = (): Review => ({ notes: [], read: [] })

/** A note's lines in the new file, whether it covers one line or several. */
export function noteRange(note: Note): Range | undefined {
  if (note.line === undefined) return undefined
  return { from: note.line, to: Math.max(note.line, note.through ?? note.line) }
}

/**
 * Whether the file still reads the way it did when the note was written. A note whose lines have
 * moved is not deleted — the reviewer meant it — but it is marked, so nobody trusts the number.
 */
export function noteIsStale(note: Note, file: FileChange | undefined): boolean {
  const range = noteRange(note)
  if (!note.quoted || !range || !file) return false
  const lines = file.after.split("\n")
  return note.quoted.some((text, index) => lines[range.from - 1 + index] !== text)
}

/** Adding a note replaces one already on the same lines, so a second thought is not a second note. */
export function addNote(review: Review, note: Note): Review {
  const range = noteRange(note)
  const clash = (other: Note) => {
    if (other.file !== note.file) return false
    const theirs = noteRange(other)
    if (!range || !theirs) return range === theirs
    return theirs.from === range.from && theirs.to === range.to
  }
  return { ...review, notes: [...review.notes.filter((other) => !clash(other)), note] }
}

export function removeNote(review: Review, file: string, line?: number): Review {
  return {
    ...review,
    notes: review.notes.filter((note) => !(note.file === file && note.line === line)),
  }
}

export function notesFor(review: Review, file: string): Note[] {
  return review.notes.filter((note) => note.file === file).sort((a, b) => (a.line ?? 0) - (b.line ?? 0))
}

/** The notes attached to one line of the new file, for drawing them under it. */
export function notesOnLine(review: Review, file: string, line: number): Note[] {
  return notesFor(review, file).filter((note) => noteRange(note)?.from === line)
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
 * The next file still to read, wrapping once. Marking a file read is meant to move you on; having
 * to find the next one yourself is the part that makes people stop doing it.
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
  notes: number
  additions: number
  deletions: number
}

export function progress(changes: ChangeSet, review: Review): Progress {
  return {
    files: changes.files.length,
    read: changes.files.filter((file) => isRead(review, file.path)).length,
    notes: review.notes.length,
    additions: changes.files.reduce((sum, file) => sum + file.additions, 0),
    deletions: changes.files.reduce((sum, file) => sum + file.deletions, 0),
  }
}

/**
 * A review with nothing in it should not be sendable: an empty message in the chat is an
 * interruption that says nothing, which is the exact thing this bay exists to stop.
 */
export function hasSomethingToSay(review: Review): boolean {
  return review.notes.length > 0 || (review.summary?.trim().length ?? 0) > 0
}
