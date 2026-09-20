/**
 * What is under review, and where it came from.
 *
 * Three sources, because `session.diff` — what *this conversation* changed — is empty most of the time
 * you actually want to read something: you usually open a conversation about work that already exists.
 * Branch is the default for that reason.
 *
 * Plain callbacks, no signals. The panel is driven by assignment (see `render/rows.ts`), so a store
 * that pushed reactive state into a slot would be pushing it somewhere nothing reads it.
 */

import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { branchChanges, withCounts, worktreeChanges } from "../../core/git/sources.ts"
import type { ChangeSet, FileChange, Source } from "../../core/model/review.ts"

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

  const sessionID = () => {
    const route = api.route.current
    return route.name === "session" ? (route.params as { sessionID?: string }).sessionID : undefined
  }

  /**
   * The conversation's own changes. `session.diff` hands back every file's before and after in full,
   * which is what lets the hunks be computed here and the line numbers stay honest.
   */
  const fromSession = async (): Promise<Loaded> => {
    const id = sessionID()
    if (!id) return { changes: empty("session"), notice: "No conversation open." }
    const diff = (await api.client.session.diff({ sessionID: id })) as unknown as FileChange[]
    return { changes: { source: "session", files: withCounts(diff ?? []) } }
  }

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
        const loaded = source === "session" ? await fromSession() : await fromGit(source)
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
