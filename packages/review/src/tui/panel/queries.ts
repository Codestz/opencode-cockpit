/**
 * What the panel knows without changing anything.
 *
 * Derived reads over the surface and the store: what is being reviewed, which thread the cursor is
 * standing on, what a note would quote. They sit apart from the verbs because reading and writing
 * being the same size of thing in one file is how that file stopped being readable — and because the
 * draw loop needs several of these and none of the verbs.
 */

import type { Host } from "@opencode-cockpit/client/host"
import type { FileChange } from "../../core/model/review.ts"
import { threadsFor, threadsOnLine } from "../../core/model/review.ts"
import type { Store } from "../data/changes.ts"
import type { Surface } from "./surface.ts"

export interface Queries {
  /** What to call what is on screen: `feat/review → main`, or "uncommitted on main". */
  label: () => string
  files: () => FileChange[]
  /** The thread the cursor is genuinely on. */
  hereThreadId: () => string | undefined
  /** What an action reaches, which is more than what the cursor is on. */
  reachableThreadId: () => string | undefined
  /** The lines a note is about, as they read right now. */
  quoteOf: (path: string, from: number | undefined, to?: number) => string[] | undefined
  /** The lines the diff is showing, in order, so the cursor has something to walk. */
  /** Every changed file as it reads now, by path — what decides whether a comment still has code. */
  contents: () => ReadonlyMap<string, string>
}

export function createQueries(api: Host, surface: Surface, store: Store): Queries {
  /**
   * What to call what is on screen.
   *
   * "branch" is a category, not an answer — `feat/review → main` says which branch you are reading
   * and what it is being compared against, which is the question you actually had.
   */
  const label = () => {
    const vcs = api.state.vcs
    const here = vcs?.branch
    const base = store.current().changes.base
    if (store.source() === "worktree") return here ? `uncommitted on ${here}` : "uncommitted"
    return here && base && here !== base ? `${here} → ${base}` : (here ?? "branch")
  }

  const files = () => store.current().changes.files

  /**
   * The thread the cursor is genuinely on: one attached to this line, or one picked by clicking it.
   *
   * Deliberately *not* falling back to the file's own thread. That fallback made every line in a file
   * with a file-level note look like it had a thread, which turned the footer into the thread's keys
   * for the whole file and hid moving and selecting behind them.
   */
  const hereThreadId = (): string | undefined => {
    const { view, review } = surface
    if (!view.file) return undefined
    if (view.thread && review.threads.some((each) => each.id === view.thread)) return view.thread
    if (view.pane !== "diff") return undefined
    /** On the file's heading, the file's own thread is the one you are standing on. */
    if (view.line === undefined)
      return threadsFor(review, view.file).find((each) => each.line === undefined)?.id
    return threadsOnLine(review, view.file, view.line)[0]?.id
  }

  /**
   * What an action reaches, which is more than what the cursor is on.
   *
   * A thread about the whole file sits on no line, so it can never be under a cursor — but `f`,
   * `enter` on the file list, and a click on the heading all mean it.
   */
  const reachableThreadId = (): string | undefined => {
    const { view, review } = surface
    if (!view.file) return undefined
    return hereThreadId() ?? threadsFor(review, view.file).find((each) => each.line === undefined)?.id
  }

  /**
   * The line a note was written against, kept with it.
   *
   * A later turn moves the code out from under a note, and a review that quotes the wrong line is
   * worse than one that admits the line has moved — so the text is recorded now, while it is true.
   */
  const quoteOf = (path: string, from: number | undefined, to?: number): string[] | undefined => {
    if (from === undefined) return undefined
    const file = files().find((candidate) => candidate.path === path)
    if (!file) return undefined
    const lines = file.after.split("\n")
    const last = Math.max(from, to ?? from)
    const quoted = lines.slice(from - 1, last)
    return quoted.length > 0 ? quoted : undefined
  }

  const contents = (): ReadonlyMap<string, string> => new Map(files().map((file) => [file.path, file.after]))

  return { label, files, hereThreadId, reachableThreadId, quoteOf, contents }
}
