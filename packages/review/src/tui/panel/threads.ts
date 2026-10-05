/**
 * What the panel does to threads and files: a comment on lines, a file or a range, a reply, a thread
 * taken back, read or answered, a file viewed or folded — and submit, which hands the comments to the
 * agent.
 */

import {
  drop,
  isRead,
  open as openThread,
  say,
  threadOn,
  threadsFor,
  threadsOnLine,
  toggleRead,
} from "../../core/model/review.ts"
import { submission, toolsConfigured, waitingOnAgent } from "../../core/model/submit.ts"
import { streamOrder, streamScroll } from "../../core/view/stream.ts"
import { askForNote, noteFields, replyFields, submitFields } from "../view/dialogs.tsx"
import type { ActionDeps } from "./actions.ts"
import type { Navigation } from "./navigation.ts"

export interface Threads {
  comment: (whole?: boolean) => void
  selectRange: () => void
  replyHere: () => void
  submit: () => void
  uncomment: () => void
  markRead: () => void
  toggleViewed: (path?: string) => void
  toggleFold: (path?: string) => void
  commentFile: (path: string) => void
}

export function createThreads(deps: ActionDeps, navigation: Navigation): Threads {
  const { api, surface, store, guard, queries, draw, keep, listHeight } = deps
  const persistence = deps.persistence
  const takeKeys = deps.takeKeys
  const dropKeys = deps.dropKeys
  const close = deps.close
  const REVIEW_PACKAGE = deps.reviewPackage
  const { listState, streamNow, follow } = navigation

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

  return {
    comment,
    selectRange,
    replyHere,
    submit,
    uncomment,
    markRead,
    toggleViewed,
    toggleFold,
    commentFile,
  }
}
