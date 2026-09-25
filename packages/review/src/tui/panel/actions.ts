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

import type { Host } from "@opencode-cockpit/client/host"
import { baseCandidates } from "../../core/git/sources.ts"
import type { Guard } from "../../core/guard.ts"
import {
  drop,
  filesElsewhere,
  isRead,
  open as openThread,
  type Source,
  say,
  threadOn,
  threadsFor,
  threadsOnLine,
  toggleRead,
} from "../../core/model/review.ts"
import { submission, toolsConfigured, waitingOnAgent } from "../../core/model/submit.ts"
import type { Persistence } from "../../core/store/persist.ts"
import { mostShift } from "../../core/view/diff.ts"
import { streamWidth } from "../../core/view/layout.ts"
import { keepCursorVisible, navigableRows } from "../../core/view/list.ts"
import type { Viewport } from "../../core/view/state.ts"
import {
  cursorRow,
  segmentAt,
  stopsOf,
  streamOf,
  streamOrder,
  streamScroll,
  streamWindow,
} from "../../core/view/stream.ts"
import type { Store } from "../data/changes.ts"
import { askForBase, askForNote, noteFields, replyFields, submitFields } from "../view/dialogs.tsx"
import type { Queries } from "./queries.ts"
import type { Surface } from "./surface.ts"

export interface ActionDeps {
  api: Host
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
  /** The commit the working tree is on, for recording on a new thread. */
  head: () => string | undefined
  /** The pane's size, which is what the stream's heights are measured against. */
  viewport: () => Viewport
}

export interface Actions {
  move: (delta: number) => void
  scroll: (delta: number) => void
  /** The code sideways, by columns: negative is back towards the start of the lines. */
  pan: (delta: number) => void
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
  chooseBase: () => void
  /** Folds or unfolds a file — the one under the cursor, or the one named. */
  toggleFold: (path?: string) => void
  /** Marks a file viewed or not, without moving the cursor anywhere. */
  toggleViewed: (path?: string) => void
  /** A note on a whole file, from its heading. */
  commentFile: (path: string) => void
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
  /** The view the list is actually drawn from, including files that have comments but no diff. */
  const listState = () => ({
    ...surface.view,
    elsewhere: filesElsewhere(surface.review, store.current().changes),
  })

  const moveFiles = (delta: number) => {
    const rows = navigableRows(store.current().changes, listState())
    if (rows.length === 0) return
    const at = surface.view.cursor ? rows.findIndex((row) => row.path === surface.view.cursor) : 0
    const next = rows[Math.max(0, Math.min(rows.length - 1, (at < 0 ? 0 : at) + delta))]
    if (!next) return
    surface.view = { ...surface.view, cursor: next.path }
    if (next.kind === "file")
      surface.view = {
        ...surface.view,
        file: next.path,
        scroll: undefined,
        line: undefined,
        anchor: undefined,
      }
    surface.view = {
      ...surface.view,
      listOffset: keepCursorVisible(store.current().changes, listState(), listHeight()),
    }
    draw()
  }

  /** The stream as the paint will draw it, for the keys to reason about. */
  const width = () => streamWidth(deps.viewport())
  const streamNow = () => streamOf(store.current().changes, surface.review, listState(), width())

  /**
   * Scrolls just enough to keep the cursor in view, and keeps the file list pointing at its file.
   *
   * One row of margin at the top, because the pinned heading covers the first row of the pane: a
   * cursor on that row would be hidden under the name of its own file.
   */
  const follow = () => {
    const stream = streamNow()
    const height = listHeight()
    const scroll = streamScroll(stream, surface.view, height)
    const row = cursorRow(stream, surface.review, surface.view, width())
    let next = scroll
    if (row !== undefined) {
      const top = surface.view.line === undefined ? row : row - 1
      if (top < scroll) next = top
      else if (row > scroll + height - 3) next = row - height + 3
    }
    surface.view = { ...surface.view, scroll: Math.max(0, next), cursor: surface.view.file }
    surface.view = {
      ...surface.view,
      listOffset: keepCursorVisible(store.current().changes, listState(), listHeight()),
    }
  }

  /**
   * In the diff, the cursor walks the stream: a file's heading, then its lines, then the next file's
   * heading. A folded file is one stop — its heading — so viewed files are stepped over in one press.
   */
  const moveLines = (delta: number) => {
    const { segments } = streamNow()
    if (segments.length === 0) return
    let index = Math.max(
      0,
      segments.findIndex((segment) => segment.path === surface.view.file),
    )
    let segment = segments[index]
    if (!segment) return
    let stops = stopsOf(segment, surface.review, surface.view, width())
    let at = Math.max(0, stops.indexOf(surface.view.line))
    const step = Math.sign(delta)
    for (let left = Math.abs(delta); left > 0; left--) {
      if (at + step >= 0 && at + step < stops.length) {
        at += step
        continue
      }
      const neighbour = segments[index + step]
      if (!neighbour) break
      index += step
      segment = neighbour
      stops = stopsOf(segment, surface.review, surface.view, width())
      at = step > 0 ? 0 : stops.length - 1
    }
    const moved = segment.path !== surface.view.file
    surface.view = {
      ...surface.view,
      file: segment.path,
      line: stops[at],
      thread: undefined,
      /** A selection is inside one file: leaving the file lets go of it. */
      ...(moved ? { anchor: undefined } : {}),
    }
    follow()
    draw()
  }

  const move = (delta: number) => (surface.view.pane === "diff" ? moveLines(delta) : moveFiles(delta))

  /**
   * Scrolling moves the view, and the cursor only if the view leaves it behind — then it lands on the
   * first thing in sight, so the next `j` carries on from what you are looking at rather than jumping
   * back to where you were.
   */
  /**
   * Sideways through the code of the file under the cursor, as far as its longest line. A line that
   * ran past the pane used to end in "…" with no way to read the rest.
   */
  const pan = (delta: number) => {
    const file = store.current().changes.files.find((change) => change.path === surface.view.file)
    const most = mostShift(file, width())
    const shift = Math.max(0, Math.min(most, (surface.view.shift ?? 0) + delta))
    if (shift === (surface.view.shift ?? 0)) return
    surface.view = { ...surface.view, shift, pane: "diff" }
    draw()
  }

  const scroll = (delta: number) => {
    const stream = streamNow()
    const height = listHeight()
    const next = Math.max(0, streamScroll(stream, surface.view, height) + delta)
    surface.view = {
      ...surface.view,
      scroll: streamScroll(stream, { ...surface.view, scroll: next }, height),
    }
    const at = surface.view.scroll ?? 0
    const row = cursorRow(stream, surface.review, surface.view, width())
    if (row === undefined || row < at || row >= at + height) {
      const shown = streamWindow(store.current().changes, surface.review, listState(), width(), height)
      /** Past the pinned heading, onto the first line of code in sight, if there is one. */
      const landing = shown.slice(1).find((each) => each.line !== undefined || each.header) ?? shown[0]
      const file = landing?.file ?? segmentAt(stream, at)?.path
      if (file) {
        surface.view = {
          ...surface.view,
          file,
          cursor: file,
          line: landing?.header ? undefined : landing?.line,
          anchor: undefined,
        }
      }
    }
    /** The file list follows the diff: the file you are reading stays in sight on the left too. */
    surface.view = {
      ...surface.view,
      cursor: surface.view.file,
      listOffset: keepCursorVisible(
        store.current().changes,
        { ...listState(), cursor: surface.view.file },
        height,
      ),
    }
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
    if (surface.view.pane === "diff" && surface.view.file === undefined)
      surface.view = { ...surface.view, file: streamNow().segments[0]?.path, scroll: undefined }
    draw()
  }

  /** Enter on a folder folds it; on a file it opens it and moves you into the diff. */
  const enter = () => {
    if (surface.view.pane === "diff") return toggleFold()
    const rows = navigableRows(store.current().changes, listState())
    const row = rows.find((candidate) => candidate.path === surface.view.cursor)
    if (!row) return
    if (row.kind === "file") {
      surface.view = { ...surface.view, file: row.path, scroll: undefined, pane: "diff", line: undefined }
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
    /** On a file's heading there is no line: a note there is about the file. */
    const onFile = whole || surface.view.pane === "files" || surface.view.line === undefined
    const from = onFile
      ? undefined
      : Math.min(surface.view.anchor ?? surface.view.line ?? 0, surface.view.line ?? 0)
    const to = onFile
      ? undefined
      : Math.max(surface.view.anchor ?? surface.view.line ?? 0, surface.view.line ?? 0)
    /**
     * The thread already here: written on exactly these lines, or — for one line — drawn on it now,
     * its code having moved since. Missing the second made a reply a new thread above the old one.
     */
    const existing =
      threadOn(surface.review, file, from, to) ??
      (!onFile && from === to && to !== undefined
        ? threadsOnLine(surface.review, file, to, queries.contents().get(file))[0]
        : undefined)

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
                /** What the file was at when this was written. Provenance, never the anchor. */
                ...(deps.head() ? { commit: deps.head() } : {}),
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
    /** Placed by the file as it reads now, as the diff draws it (see `hereThreadId`). */
    return surface.view.line === undefined
      ? threadsFor(surface.review, surface.view.file).find((each) => each.line === undefined)
      : threadsOnLine(
          surface.review,
          surface.view.file,
          surface.view.line,
          queries.contents().get(surface.view.file),
        )[0]
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
  const hasTools = (): boolean =>
    /** On OpenCode 2 the tools arrive with this package's own server half, which v2 always loads. */
    api.v1 ? toolsConfigured(api.v1.state.config.plugin, REVIEW_PACKAGE) : true

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
    /**
     * The files go in from the first call, so what the dialog counts is what will be sent.
     *
     * They were left out here once, which meant the count offered and the count handed over could
     * differ by however many comments had gone outdated since they were written.
     */
    const ready = submission(surface.review, {
      label: queries.label(),
      tools: hasTools(),
      files: queries.contents(),
    })
    if (!ready) {
      /**
       * Three ways to have nothing to submit, and they need three different sentences.
       *
       * "Every comment has been answered" was said in all three, including to someone who had not
       * written a comment yet — which reads as the feature being broken rather than unused.
       */
      const waiting = waitingOnAgent(surface.review)
      const message =
        surface.review.threads.length === 0
          ? "Nothing to submit yet — press c on a line to leave a comment."
          : waiting.length === 0
            ? "Nothing to hand over — every comment has been answered."
            : waiting.length === 1
              ? "Nothing to hand over — the code the last comment is about is gone."
              : `Nothing to hand over — the code all ${waiting.length} comments are about is gone.`
      api.ui.toast({ variant: "info", title: "Review", message })
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
        const said = submission(surface.review, {
          label: queries.label(),
          tools: hasTools(),
          files: queries.contents(),
          summary,
        })
        if (!said) return
        guard.task("submit", async () => {
          await api.promptSession(id, said.text)
        })
        api.ui.toast({
          variant: "success",
          title: "Review",
          /** The held-back ones are said out loud: a comment that quietly did not go is a bug report. */
          message:
            said.outdated.length > 0
              ? `Handed over ${said.threads.length} comment${said.threads.length === 1 ? "" : "s"}. ${said.outdated.length} left out — their code is gone.`
              : `Handed over ${said.threads.length} comment${said.threads.length === 1 ? "" : "s"}.`,
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
    viewed(file)
    if (isRead(surface.review, file)) {
      /**
       * The next unread file after this one, in the order you are reading — or, with none left below,
       * the nearest one above. Wrapping round to the top sent you back to the first file from
       * wherever you were, which reads as the review losing your place.
       */
      const order = streamOrder(store.current().changes, listState())
      const from = order.indexOf(file)
      const unread = (path: string) => !isRead(surface.review, path)
      const next =
        order.slice(from + 1).find(unread) ?? order.slice(0, Math.max(0, from)).reverse().find(unread)
      if (next) {
        surface.view = { ...surface.view, file: next, cursor: next, scroll: undefined, line: undefined }
        surface.view = { ...surface.view, scroll: streamScroll(streamNow(), surface.view, listHeight()) }
      } else follow()
    }
    draw()
  }

  /**
   * Viewed folds a file out of the way and unviewed brings it back — so a hand-set fold is let go of
   * either way, and the default (open until viewed) takes over again.
   */
  const viewed = (path: string) => {
    surface.review = toggleRead(surface.review, path)
    const folded = new Set(surface.view.folded ?? [])
    const opened = new Set(surface.view.opened ?? [])
    folded.delete(path)
    opened.delete(path)
    surface.view = { ...surface.view, folded, opened }
    /** On a line of a file that just folded, the cursor goes up to its heading. */
    if (surface.view.file === path && isRead(surface.review, path))
      surface.view = { ...surface.view, line: undefined }
  }

  const toggleViewed = (path = surface.view.file) => {
    if (!path) return
    viewed(path)
    follow()
    draw()
  }

  const toggleFold = (path = surface.view.file) => {
    if (!path) return
    const segment = streamNow().segments.find((each) => each.path === path)
    if (!segment) return
    const folded = new Set(surface.view.folded ?? [])
    const opened = new Set(surface.view.opened ?? [])
    if (segment.open) {
      folded.add(path)
      opened.delete(path)
    } else {
      opened.add(path)
      folded.delete(path)
    }
    surface.view = { ...surface.view, folded, opened, file: path, line: undefined, anchor: undefined }
    follow()
    draw()
  }

  const commentFile = (path: string) => {
    surface.view = { ...surface.view, file: path, line: undefined, anchor: undefined }
    comment(true)
  }

  /** Uncommitted, then the branch, round and round. */
  const nextSource = () => {
    store.setSource(SOURCES[(SOURCES.indexOf(store.source()) + 1) % SOURCES.length] ?? "branch")
    deps.refresh()
  }

  /**
   * Picks the branch to compare against, and switches to branch mode — choosing a base while looking
   * at uncommitted work would change nothing you can see.
   */
  const chooseBase = () => {
    const cwd = api.state.path.worktree || api.state.path.directory
    void baseCandidates(cwd).then((found) => {
      const candidates = [...found].sort((a, b) => a.own - b.own || a.ref.localeCompare(b.ref))
      dropKeys()
      askForBase(
        api,
        {
          ...(store.base() ? { current: store.base() } : {}),
          ...(store.current().changes.base ? { guessed: store.current().changes.base } : {}),
          candidates,
        },
        (base) => {
          store.setBase(base)
          store.setSource("branch")
          deps.refresh()
        },
        () => {
          if (surface.open) takeKeys()
          draw()
        },
      )
    })
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
    chooseBase,
    toggleFold,
    toggleViewed,
    commentFile,
    submit,
    toggleStats,
    pan,
    cycle: deps.cycle,
    close,
    reload: deps.refresh,
  }
}
