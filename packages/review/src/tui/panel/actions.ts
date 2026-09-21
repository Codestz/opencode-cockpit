/**
 * Everything the panel *does*.
 *
 * One verb per thing a person can ask for, and each one ends the same way: change the surface, ask for
 * a paint. They lived inside `takeKeys` — four hundred lines nested in the function that registered the
 * keymap — which meant a verb could not be read without reading the keymap, and neither could be moved
 * without moving the other.
 *
 * Nothing here knows which key it is bound to. That table is `keys.ts`, and keeping it separate is what
 * lets a key change without touching what it does.
 */

import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { Guard } from "../../core/guard.ts"
import {
  drop,
  isRead,
  nextUnread,
  open as openThread,
  type Source,
  say,
  threadOn,
  threadsFor,
  threadsOnLine,
  toggleRead,
} from "../../core/model/review.ts"
import { submission, toolsConfigured } from "../../core/model/submit.ts"
import type { Persistence } from "../../core/store/persist.ts"
import { keepCursorVisible, navigableRows } from "../../core/view/list.ts"
import type { Store } from "../data/changes.ts"
import { askForNote, noteFields, replyFields, submitFields } from "../view/dialogs.tsx"
import type { Queries } from "./queries.ts"
import type { Surface } from "./surface.ts"

export interface ActionDeps {
  api: TuiPluginApi
  surface: Surface
  store: Store
  guard: Guard
  queries: Queries
  /** Asks for a paint. Every verb ends with one. */
  draw: () => void
  /** The threads on disk for the branch being reviewed — re-read, because the branch can change. */
  persistence: () => Persistence
  /** Saves one thread, and says nothing if it cannot. */
  keep: (id: string | undefined) => void
  /** How many rows of the diff are visible, which scrolling and clicking have to agree on. */
  listHeight: () => number
  /** Reloads the diff. */
  refresh: () => void
  /** The keys, given up while a dialog has them and taken back after. */
  takeKeys: () => void
  dropKeys: () => void
  close: () => void
  /** Right pane, or full screen. */
  cycle: () => void
  /** The package name the tools would be registered under, for deciding what submit sends. */
  reviewPackage: string
  /** The sources to cycle through. */
  sources: readonly Source[]
}

export interface Actions {
  move: (delta: number) => void
  scroll: (delta: number) => void
  swap: () => void
  enter: () => void
  toFiles: () => void
  comment: (whole?: boolean) => void
  replyHere: () => void
  commentOrReply: () => void
  selectRange: () => void
  uncomment: () => void
  markRead: () => void
  nextSource: () => void
  submit: () => void
  toggleStats: () => void
  cycle: () => void
  close: () => void
  reload: () => void
}

export function createActions(deps: ActionDeps): Actions {
  const { api, surface, store, guard, queries, draw, keep, listHeight } = deps
  const persistence = deps.persistence
  const takeKeys = deps.takeKeys
  const dropKeys = deps.dropKeys
  const close = deps.close
  const REVIEW_PACKAGE = deps.reviewPackage
  const SOURCES = deps.sources

  /**
   * Movement follows the rows on screen, not the change set's own file order.
   *
   * Those are two different orders — the screen shows a grouped tree, the change set is however git
   * listed things — and driving the cursor from the second while looking at the first is why it
   * appeared to jump at random.
   */
  const moveFiles = (delta: number) => {
    const rows = navigableRows(store.current().changes, surface.view)
    if (rows.length === 0) return
    const at = surface.view.cursor ? rows.findIndex((row) => row.path === surface.view.cursor) : 0
    const next = rows[Math.max(0, Math.min(rows.length - 1, (at < 0 ? 0 : at) + delta))]
    if (!next) return
    surface.view = { ...surface.view, cursor: next.path }
    if (next.kind === "file")
      surface.view = { ...surface.view, file: next.path, scroll: 0, line: undefined, anchor: undefined }
    surface.view = {
      ...surface.view,
      listOffset: keepCursorVisible(store.current().changes, surface.view, listHeight()),
    }
    draw()
  }

  /** In the diff, the cursor walks lines of the new file — which is what a note attaches to. */
  const moveLines = (delta: number) => {
    const lines = queries.diffLines()
    if (lines.length === 0) return
    const at = surface.view.line === undefined ? 0 : lines.indexOf(surface.view.line)
    const next = lines[Math.max(0, Math.min(lines.length - 1, (at < 0 ? 0 : at) + delta))]
    if (next === undefined) return
    surface.view = { ...surface.view, line: next, thread: undefined }
    /** Keep the cursor in sight without yanking the view around it. */
    const index = lines.indexOf(next)
    const height = listHeight()
    const scroll = surface.view.scroll ?? 0
    if (index < scroll) surface.view = { ...surface.view, scroll: index }
    else if (index > scroll + height - 3) surface.view = { ...surface.view, scroll: index - height + 3 }
    draw()
  }

  const move = (delta: number) => (surface.view.pane === "diff" ? moveLines(delta) : moveFiles(delta))

  const scroll = (delta: number) => {
    surface.view = { ...surface.view, scroll: Math.max(0, (surface.view.scroll ?? 0) + delta) }
    draw()
  }

  /**
   * Out of the diff and back to the list.
   *
   * `enter` takes you into a file, so something has to take you out, and `tab` alone is a thing you
   * have to be told. `h` and `left` are where a hand already is after `j`/`k`.
   */
  const toFiles = () => {
    surface.view = { ...surface.view, pane: "files", anchor: undefined }
    draw()
  }

  /** Two panes, one keyboard: `tab` says which one `j` is talking to. */
  const swap = () => {
    surface.view = { ...surface.view, pane: surface.view.pane === "diff" ? "files" : "diff" }
    if (surface.view.pane === "diff" && surface.view.line === undefined)
      surface.view = { ...surface.view, line: queries.diffLines()[0] }
    draw()
  }

  /** Enter on a folder folds it; on a file it opens it and moves you into the diff. */
  const enter = () => {
    const rows = navigableRows(store.current().changes, surface.view)
    const row = rows.find((candidate) => candidate.path === surface.view.cursor)
    if (!row) return
    if (row.kind === "file") {
      surface.view = { ...surface.view, file: row.path, scroll: 0, pane: "diff", line: undefined }
      surface.view = { ...surface.view, line: queries.diffLines()[0] }
    } else {
      const collapsed = new Set(surface.view.collapsed ?? [])
      if (collapsed.has(row.path)) collapsed.delete(row.path)
      else collapsed.add(row.path)
      surface.view = { ...surface.view, collapsed }
    }
    draw()
  }

  /**
   * One key, and it comments on whatever the cursor is on: the selected lines, the line under the
   * cursor, or — in the file list — the file as a whole. Two keys for the same intention is two
   * keys to remember for no reason.
   */
  const comment = (whole = false) => {
    const file = surface.view.file
    if (!file) return
    const onFile = whole || surface.view.pane === "files"
    const from = onFile
      ? undefined
      : Math.min(surface.view.anchor ?? surface.view.line ?? 0, surface.view.line ?? 0)
    const to = onFile
      ? undefined
      : Math.max(surface.view.anchor ?? surface.view.line ?? 0, surface.view.line ?? 0)
    const existing = threadOn(surface.review, file, from, to)

    /**
     * The review's keys are a *global* layer, so they are still live while a dialog is open — which
     * means typing a note would trigger them and `escape` would close the review out from under the
     * prompt. They go away for as long as the dialog is up.
     */
    dropKeys()

    askForNote(
      api,
      noteFields(file, {
        ...(from === undefined ? {} : { from }),
        ...(to === undefined ? {} : { to }),
        ...(existing ? { existing } : {}),
        ...(queries.quoteOf(file, from, to) ? { quoted: queries.quoteOf(file, from, to) } : {}),
      }),
      (body) => {
        const at = Date.now()
        surface.review = existing
          ? say(surface.review, existing.id, { author: "you", body, at })
          : openThread(
              surface.review,
              {
                file,
                ...(from === undefined ? {} : { line: from }),
                ...(to !== undefined && from !== undefined && to > from ? { through: to } : {}),
                ...(queries.quoteOf(file, from, to) ? { quoted: queries.quoteOf(file, from, to) } : {}),
              },
              body,
              "you",
              at,
            )
        /** Written as it is said. A note you have to remember to save is a note you will lose. */
        keep(existing?.id ?? threadOn(surface.review, file, from, to)?.id)
        surface.view = { ...surface.view, anchor: undefined }
        draw()
      },
      () => {
        /** However it closed, the keys come back and the pane is drawn again. */
        if (surface.open) takeKeys()
        draw()
      },
    )
  }

  /** Starts a selection, or throws one away. The moving end is the cursor. */
  const selectRange = () => {
    surface.view =
      surface.view.anchor === undefined
        ? { ...surface.view, anchor: surface.view.line }
        : { ...surface.view, anchor: undefined }
    draw()
  }

  /**
   * The thread under the cursor, which is what `r`, `o` and `x` act on.
   *
   * Derived rather than navigated: a thread lives on a line, so standing on the line is standing
   * on the thread. A second cursor for threads would be a second thing to move and to explain.
   */
  const hereThread = () => {
    if (!surface.view.file) return undefined
    if (surface.view.pane === "files")
      return threadsFor(surface.review, surface.view.file).find((each) => each.line === undefined)
    return surface.view.line === undefined
      ? undefined
      : threadsOnLine(surface.review, surface.view.file, surface.view.line)[0]
  }

  /**
   * Answering back.
   *
   * Saying something on a resolved thread reopens it, which is the honest meaning of a reply: you
   * have read the answer and it is not finished. Accepting needs no key — a thread you say nothing
   * more about is one you accepted.
   */
  const replyHere = () => {
    const thread = hereThread()
    if (!thread) return comment()
    dropKeys()
    askForNote(
      api,
      replyFields(thread),
      (body) => {
        surface.review = say(surface.review, thread.id, { author: "you", body, at: Date.now() })
        keep(thread.id)
        draw()
      },
      () => {
        if (surface.open) takeKeys()
        draw()
      },
    )
  }

  /**
   * Whether the agent has the review tools.
   *
   * Read from the user's own plugin list rather than guessed: only this half can see it, and telling
   * an agent to "run review_list" when it has no such tool is worse than sending it too much. When
   * the server half is not installed the whole review travels as prose instead.
   */
  const hasTools = (): boolean => toolsConfigured(api.state.config.plugin, REVIEW_PACKAGE)

  /** The conversation this review would be handed to. */
  const sessionID = (): string | undefined => {
    const route = api.route.current
    return route.name === "session" ? (route.params as { sessionID?: string }).sessionID : undefined
  }

  /**
   * Handing the review over.
   *
   * The end of reading, so it closes the pane: what happens next happens in the conversation, and
   * leaving a review open over the answer to it is leaving the screen on the wrong thing.
   */
  const submit = () => {
    const ready = submission(surface.review, { label: queries.label(), tools: hasTools() })
    if (!ready) {
      api.ui.toast({
        variant: "info",
        title: "Review",
        message: "Nothing to hand over — every comment has been answered.",
      })
      return
    }
    const id = sessionID()
    if (!id) {
      api.ui.toast({
        variant: "error",
        title: "Review",
        message: "Open a conversation to submit a review to.",
      })
      return
    }

    dropKeys()
    askForNote(
      api,
      submitFields(queries.label(), ready.threads.length),
      (summary) => {
        const said = submission(surface.review, { label: queries.label(), tools: hasTools(), summary })
        if (!said) return
        guard.task("submit", async () => {
          await api.client.session.promptAsync({
            sessionID: id,
            parts: [{ type: "text", text: said.text }],
          })
        })
        api.ui.toast({
          variant: "success",
          title: "Review",
          message: `Handed over ${said.threads.length} comment${said.threads.length === 1 ? "" : "s"}.`,
        })
        close()
      },
      () => {
        if (surface.open) takeKeys()
        draw()
      },
    )
  }

  /** Throws a thread away. Resolving is what the agent does; this is what you do to a mistake. */
  const uncomment = () => {
    const thread = hereThread()
    if (!thread) return
    surface.review = drop(surface.review, thread.id)
    void persistence()
      .remove(thread.id)
      .catch(() => {})
    draw()
  }

  /**
   * A global layer, registered only while the review is open. A layer with a `target` matches the
   * *keymap host's* focused target, which stays the prompt whatever `focus()` sets on our own box —
   * so scoping by target silently never fires. Global means these letters are really taken, which
   * is why the layer is disposed the moment the review closes.
   */

  /**
   * Marking a file read, and going to the next one that is not.
   *
   * Reading a review is a sweep, not a browse: the useful thing after finishing a file is the next
   * file, not the file list. Unmarking does not move you, because unmarking is a correction.
   */
  const markRead = () => {
    const file = surface.view.file
    if (!file) return
    surface.review = toggleRead(surface.review, file)
    if (isRead(surface.review, file)) {
      const next = nextUnread(store.current().changes, surface.review, file)
      if (next) surface.view = { ...surface.view, file: next, cursor: next, scroll: 0, line: undefined }
    }
    draw()
  }

  /** Branch, uncommitted, this conversation — in that order, round and round. */
  const nextSource = () => {
    store.setSource(SOURCES[(SOURCES.indexOf(store.source()) + 1) % SOURCES.length] ?? "branch")
    deps.refresh()
  }

  /**
   * The numbers are always being kept; this is only whether you are looking at them.
   *
   * A debug mode you have to switch on is off during every problem worth seeing, so the counting never
   * stops — and when something feels slow the evidence is already there.
   */
  const toggleStats = () => {
    surface.showStats = !surface.showStats
    guard.clear()
    draw()
  }

  return {
    move,
    scroll,
    swap,
    enter,
    toFiles,
    comment,
    replyHere,
    /** One key for saying something: a thread where you are standing means you are answering it. */
    commentOrReply: () => (queries.reachableThreadId() ? replyHere() : comment()),
    selectRange,
    uncomment,
    markRead,
    nextSource,
    submit,
    toggleStats,
    cycle: deps.cycle,
    close,
    reload: deps.refresh,
  }
}
