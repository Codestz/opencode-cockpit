/**
 * What is under review, and where it came from.
 *
 * Two questions a reviewer asks, and git answers both: what have I not committed, and what does this
 * branch change. Branch is the default, because the work you want to read is usually already
 * committed by the time you go looking for it.
 *
 * There was a third source once — what *this conversation* changed — and it is gone. The host's
 * `session.diff` returns an empty list for a session whose own snapshots plainly differ, so the mode
 * could only ever promise something it did not deliver. Cockpit could record the agent's edits itself,
 * and may yet; until it does, nothing here claims to know which changes were the agent's.
 *
 * Plain callbacks, no signals. The panel is driven by assignment (see `view/pool.ts`), so a store
 * that pushed reactive state into a slot would be pushing it somewhere nothing reads it.
 */

import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { branchChanges, withCounts, worktreeChanges } from "../../core/git/sources.ts"
import type { ChangeSet, Source } from "../../core/model/review.ts"

export interface Loaded {
  changes: ChangeSet
  /** Anything git could not do, phrased for a person rather than copied from stderr. */
  notice?: string
}

export interface Store {
  source: () => Source
  setSource: (next: Source) => void
  /** Re-reads from the current source. Safe to call often; the last call in wins. */
  load: () => Promise<Loaded>
  /** The most recent result, for drawing without waiting. */
  current: () => Loaded
  loading: () => boolean
}

const empty = (source: Source): ChangeSet => ({ source, files: [] })

export function createStore(api: TuiPluginApi, initial: Source = "branch"): Store {
  let source = initial
  let latest: Loaded = { changes: empty(initial) }
  let inFlight = 0
  let busy = false

  const directory = () => api.state.path.worktree || api.state.path.directory

  const fromGit = async (which: "worktree" | "branch"): Promise<Loaded> => {
    const cwd = directory()
    const result =
      which === "worktree"
        ? await worktreeChanges(cwd)
        : await branchChanges(cwd, api.state.vcs?.default_branch)
    const loaded: Loaded = { changes: { source: which, files: withCounts(result.files) } }
    if (result.errors[0]) loaded.notice = result.errors[0]
    return loaded
  }

  return {
    source: () => source,
    setSource: (next) => {
      source = next
    },
    current: () => latest,
    loading: () => busy,
    async load() {
      const ticket = ++inFlight
      busy = true
      try {
        const loaded = await fromGit(source)
        /** A slower earlier read must not overwrite a faster later one. */
        if (ticket === inFlight) latest = loaded
        return latest
      } catch (error) {
        const notice = error instanceof Error ? error.message : String(error)
        if (ticket === inFlight) latest = { changes: empty(source), notice }
        return latest
      } finally {
        if (ticket === inFlight) busy = false
      }
    },
  }
}
