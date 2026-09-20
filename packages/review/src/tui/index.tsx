/** @jsxImportSource @opentui/solid */

import { createBindingLookup, type TuiPlugin, type TuiPluginModule } from "@opencode-ai/plugin/tui"
import { claimFeature, duplicateFeatureMessage } from "@opencode-cockpit/client/feature"
import type { BoxRenderable } from "@opentui/core"
import {
  drop,
  emptyReview,
  isRead,
  nextUnread,
  open as openThread,
  type Review,
  type Source,
  say,
  threadOn,
  threadsFor,
  threadsOnLine,
  toggleRead,
} from "../core/model/review.ts"
import { threadWhere } from "../core/model/thread.ts"
import { reviewPaths } from "../core/store/paths.ts"
import { createPersistence } from "../core/store/persist.ts"
import { frameBounds, VARIANTS, type Variant } from "../core/view/frame.ts"
import {
  diffRows,
  FOOTER_ROWS,
  HEADER_ROWS,
  keepCursorVisible,
  layout,
  listScroll,
  navigableRows,
  splitColumns,
  type ViewState,
  visibleDiffLines,
  visibleDiffRows,
} from "../core/view/layout.ts"
import { languageOf } from "../core/view/syntax.ts"
import { Overlay } from "./components/overlay.tsx"
import { askForNote } from "./dialogs.tsx"
import { createHighlighter } from "./render/highlighter.ts"
import { createRowPool, type RowPool } from "./render/rows.ts"
import { createStore } from "./state/store.ts"

/** Global keys, leader-prefixed and few. `<leader>` is OpenCode's own prefix — `ctrl+x` by default. */
const DEFAULT_KEYS = {
  "cockpit.review.open": "<leader>v",
  "cockpit.review.place": "<leader>r",
}

const REVIEW_PACKAGE = "@opencode-cockpit/review"

/** Above Shell's dock (150), below the statusline (200). */
const SLOT_ORDER = 180

const SOURCES: Source[] = ["branch", "worktree", "session"]

export interface ReviewTuiOptions {
  /** Which placement to open in: right | full. */
  variant?: Variant
  /** What to review on open: branch | worktree | session. */
  source?: Source
  keybinds?: Record<string, string>
}

/** Review's TUI half as a factory, so bundles such as `opencode-cockpit` can include it. */
export function createReviewTui({ source = REVIEW_PACKAGE }: { source?: string } = {}): TuiPlugin {
  return async (api, rawOptions) => {
    // The renderer is shared by every TUI plugin in this OpenCode window.
    const claim = claimFeature(api.renderer, "review", source)
    if (!claim.active) {
      api.ui.toast({
        variant: "warning",
        title: "opencode-cockpit",
        message: duplicateFeatureMessage("Review", claim.owner, source),
        duration: 10_000,
      })
      return
    }
    api.lifecycle.onDispose(() => claim.release())

    const options = (rawOptions ?? {}) as ReviewTuiOptions
    const keys = createBindingLookup({ ...DEFAULT_KEYS, ...options.keybinds })
    const store = createStore(api, options.source ?? "branch")
    /**
     * A real parse when the host's tree-sitter client will do one, and the built-in tokenizer until
     * then — or for ever, if the client misbehaves once. Probing it outside a renderer showed it
     * hanging rather than failing, so it is never awaited on the draw path.
     */
    const highlighter = createHighlighter(() => api.theme.current)

    /**
     * Plain variables, not signals. Nothing inside a slot's tree is reactive, so state that the panel
     * must reflect is state the panel is *told* about — see `render/rows.ts`.
     */
    let backdrop: BoxRenderable | undefined
    let panel: BoxRenderable | undefined
    let pool: RowPool | undefined
    let open = false
    let variant: Variant = options.variant ?? "right"
    let review: Review = emptyReview()

    /**
     * Threads are kept on disk, one file each, keyed by the branch they are about.
     *
     * A review is about the *work*, not the conversation: you read a branch, leave notes, the agent
     * answers them, and somewhere in the middle you may well start a new chat. That should no more
     * lose your review than it loses your branch — and a half-finished review is a half-finished job,
     * not a piece of interface state to throw away on exit.
     */
    let persistence = createPersistence(
      reviewPaths(api.state.path.worktree || api.state.path.directory, api.state.vcs?.branch),
    )

    /** Saves one thread, and says nothing if it cannot: a review that will not persist still works. */
    const keep = (id: string | undefined) => {
      if (!id) return
      const thread = review.threads.find((each) => each.id === id)
      if (thread) void persistence.save(thread).catch(() => {})
    }
    let view: ViewState = { context: 3, collapsed: new Set() }
    /** Where the list starts on screen, so a click can be turned into a row. */
    const listTop = () => (panel?.y ?? 0) + 1 + HEADER_ROWS
    /** How many rows of it are visible, which both scrolling and clicking need to agree on. */
    /** The viewport the layout is drawn into, which clicking and drawing have to agree on. */
    const viewport = () => ({
      width: frameBounds(variant, { width: api.renderer.width, height: api.renderer.height }).width,
      height: api.renderer.height - 2,
    })
    const listHeight = () => Math.max(1, (panel?.height ?? 20) - 2 - HEADER_ROWS - FOOTER_ROWS)
    let disposeKeys: (() => void) | undefined

    /**
     * What to call what is on screen.
     *
     * "branch" is a category, not an answer — `feat/review → main` says which branch you are reading
     * and what it is being compared against, which is the question you actually had.
     */
    const label = () => {
      const vcs = api.state.vcs
      const here = vcs?.branch
      const base = vcs?.default_branch
      switch (store.source()) {
        case "branch":
          return here && base && here !== base ? `${here} → ${base}` : (here ?? "branch")
        case "worktree":
          return here ? `uncommitted on ${here}` : "uncommitted"
        default:
          return "this conversation"
      }
    }

    const files = () => store.current().changes.files

    /**
     * The thread the cursor is standing on, for drawing it open and heavier than the rest.
     *
     * Derived from the line rather than navigated to: a thread lives on a line, so standing on the
     * line is standing on the thread, and a second cursor would be a second thing to explain.
     */
    /**
     * The thread the cursor is genuinely on: one attached to this line, or one picked by clicking it.
     *
     * Deliberately *not* falling back to the file's own thread. That fallback made every line in a
     * file with a file-level note look like it had a thread, which turned the footer into the
     * thread's keys for the whole file and hid moving and selecting behind them.
     */
    const hereThreadId = (): string | undefined => {
      if (!view.file) return undefined
      if (view.thread && review.threads.some((each) => each.id === view.thread)) return view.thread
      if (view.pane !== "diff" || view.line === undefined) return undefined
      return threadsOnLine(review, view.file, view.line)[0]?.id
    }

    /**
     * What an action reaches, which is more than what the cursor is on.
     *
     * A thread about the whole file sits on no line, so it can never be under a cursor — but `f`,
     * `enter` on the file list, and a click on the heading all mean it.
     */
    const reachableThreadId = (): string | undefined => {
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

    /** Everything on screen, recomputed and pushed onto the boxes. */
    const draw = () => {
      if (!backdrop || !panel) return
      const screen = { width: api.renderer.width, height: api.renderer.height }
      const frame = frameBounds(variant, screen)

      backdrop.width = screen.width
      backdrop.height = open ? screen.height : 0
      backdrop.visible = open

      panel.width = frame.width
      panel.height = open ? screen.height : 0
      panel.borderColor = api.theme.current.borderActive
      /** No title: the header row inside says all of this, and saying it twice reads as a bug. */
      panel.title = ""

      if (!open) {
        pool?.clear()
      } else {
        /**
         * Hide the terminal's own cursor while the review is up, *after* the host has drawn.
         *
         * That blue block over the file list is the real cursor, still parked in the prompt underneath.
         * A terminal draws its cursor itself, above every cell, so no z-index could cover it. Hiding it
         * during our draw is not enough either: the host paints its prompt afterwards and puts the
         * cursor back, so the last word has to be ours.
         */
        setTimeout(() => {
          if (open) api.renderer.setCursorPosition(0, 0, false)
        }, 0)
        /**
         * Ask for a real parse of the file on screen — both sides of it — and draw with whatever has
         * arrived. Requests are no-ops once a file is cached, so this costs nothing per frame, and
         * nothing here is awaited: highlighting lands when it lands and the next draw picks it up.
         */
        const showing = files().find((candidate) => candidate.path === view.file)
        let highlighted: ViewState["highlighted"]
        if (showing) {
          const language = languageOf(showing.path)
          const oldSide = `${showing.path}#before`
          highlighter.request(showing.path, showing.after, language, draw)
          highlighter.request(oldSide, showing.before, language, draw)
          const after = highlighter.lines(showing.path, showing.after)
          const before = highlighter.lines(oldSide, showing.before)
          if (after || before) highlighted = { ...(after ? { after } : {}), ...(before ? { before } : {}) }
        }

        const rows = layout(
          store.current().changes,
          review,
          {
            ...view,
            label: label(),
            ...(hereThreadId() ? { thread: hereThreadId() } : {}),
            ...(view.reading ? { reading: view.reading } : {}),
            syntax: highlighted ? "tree-sitter" : "basic",
            ...(highlighted ? { highlighted } : {}),
          },
          {
            width: frame.width,
            height: screen.height - 2,
          },
        )
        pool?.draw(rows, api.theme.current)
      }
      api.renderer.requestRender()
    }

    const refresh = async () => {
      /** The branch can change under us, and the review that belongs to it changes with it. */
      persistence = createPersistence(
        reviewPaths(api.state.path.worktree || api.state.path.directory, api.state.vcs?.branch),
      )
      const [, threads] = await Promise.all([store.load(), persistence.load()])
      review = { ...review, threads }
      /** Land on something worth reading rather than on an empty pane. */
      if (!view.file || !files().some((file) => file.path === view.file)) {
        view = { ...view, ...(files()[0] ? { file: files()[0]?.path } : {}) }
      }
      draw()
    }

    /**
     * A click in the file list selects what it landed on; on a folder it folds it.
     *
     * Rows are a fixed height, so the row under the pointer is arithmetic rather than hit-testing:
     * the pointer's row, less where the list starts on screen.
     */
    const clickAt = (x: number, y: number) => {
      if (!panel) return
      const columns = splitColumns(panel.width)
      const row = y - listTop()
      if (row < 0) return

      /**
       * Each half answers to a click in its own terms: the list selects a file or folds a folder, the
       * diff puts the cursor on a line. A click that quietly did the wrong one would be the wrong thing
       * happening somewhere you were not looking.
       */
      const onList = columns.list > 0 && x <= panel.x + columns.list
      if (onList) {
        const rows = navigableRows(store.current().changes, view)
        if (rows.length === 0) return
        const entry = rows[row + listScroll(store.current().changes, view, listHeight())]
        if (!entry) return
        view = { ...view, cursor: entry.path, pane: "files" }
        if (entry.kind === "file") {
          view = { ...view, file: entry.path, scroll: 0, line: undefined, anchor: undefined }
        } else {
          const collapsed = new Set(view.collapsed ?? [])
          if (collapsed.has(entry.path)) collapsed.delete(entry.path)
          else collapsed.add(entry.path)
          view = { ...view, collapsed }
        }
        draw()
        return
      }

      const drawn = visibleDiffRows(store.current().changes, review, { ...view, pane: "diff" }, viewport())
      const at = drawn[row]
      /** A click on a thread's box is a click on the thread, whatever line it happens to sit under. */
      const picked = at?.target?.startsWith("rv_") ? at.target : undefined
      const line = at?.line
      /**
       * Clicking while a selection is open *extends* it, so `v` then a click picks a range the way
       * dragging would — the anchor stays and the click becomes the moving end. A click on a hunk
       * header or a note is not a click on a line at all; it moves the pane, not the cursor.
       */
      const keepAnchor = view.anchor !== undefined
      view = {
        ...view,
        pane: "diff",
        thread: picked,
        /** Clicking a marked line opens its thread, the way clicking a comment marker does anywhere. */
        ...(picked ? { reading: picked } : {}),
        ...(line === undefined ? {} : { line, ...(keepAnchor ? {} : { anchor: undefined }) }),
      }
      draw()
    }

    /**
     * The wheel scrolls whichever pane it is over.
     *
     * Over the list it walks the cursor, because the list *is* its scroll — it follows the cursor, so
     * moving the view without moving the cursor would fight itself on the next keypress. Over the diff
     * it scrolls the diff, which has a scroll of its own.
     */
    const scrollAt = (x: number, delta: number) => {
      if (!panel) return
      const columns = splitColumns(panel.width)
      const overList = columns.list > 0 && x <= panel.x + columns.list
      if (overList) {
        /** The view moves; the cursor stays where you left it. */
        view = { ...view, listOffset: Math.max(0, (view.listOffset ?? 0) + delta) }
      } else {
        view = { ...view, scroll: Math.max(0, (view.scroll ?? 0) + delta) }
      }
      draw()
    }

    const takeKeys = () => {
      if (disposeKeys) return

      /** The lines of the file on screen, in order, so the diff cursor has something to walk. */
      const diffLinesOf = () => {
        const file = files().find((candidate) => candidate.path === view.file)
        if (!file) return []
        return diffRows(file, review, { ...view, pane: "diff" }, 200)
          .map((row) => row.line)
          .filter((line): line is number => line !== undefined)
      }

      /**
       * Movement follows the rows on screen, not the change set's own file order.
       *
       * Those are two different orders — the screen shows a grouped tree, the change set is however git
       * listed things — and driving the cursor from the second while looking at the first is why it
       * appeared to jump at random.
       */
      const moveFiles = (delta: number) => {
        const rows = navigableRows(store.current().changes, view)
        if (rows.length === 0) return
        const at = view.cursor ? rows.findIndex((row) => row.path === view.cursor) : 0
        const next = rows[Math.max(0, Math.min(rows.length - 1, (at < 0 ? 0 : at) + delta))]
        if (!next) return
        view = { ...view, cursor: next.path }
        if (next.kind === "file")
          view = { ...view, file: next.path, scroll: 0, line: undefined, anchor: undefined }
        view = { ...view, listOffset: keepCursorVisible(store.current().changes, view, listHeight()) }
        draw()
      }

      /** In the diff, the cursor walks lines of the new file — which is what a note attaches to. */
      const moveLines = (delta: number) => {
        const lines = diffLinesOf()
        if (lines.length === 0) return
        const at = view.line === undefined ? 0 : lines.indexOf(view.line)
        const next = lines[Math.max(0, Math.min(lines.length - 1, (at < 0 ? 0 : at) + delta))]
        if (next === undefined) return
        view = { ...view, line: next, thread: undefined }
        /** Keep the cursor in sight without yanking the view around it. */
        const index = lines.indexOf(next)
        const height = Math.max(1, (panel?.height ?? 20) - 2 - HEADER_ROWS - FOOTER_ROWS)
        const scroll = view.scroll ?? 0
        if (index < scroll) view = { ...view, scroll: index }
        else if (index > scroll + height - 3) view = { ...view, scroll: index - height + 3 }
        draw()
      }

      const move = (delta: number) => (view.pane === "diff" ? moveLines(delta) : moveFiles(delta))

      const scroll = (delta: number) => {
        view = { ...view, scroll: Math.max(0, (view.scroll ?? 0) + delta) }
        draw()
      }

      /**
       * Out of the diff and back to the list.
       *
       * `enter` takes you into a file, so something has to take you out, and `tab` alone is a thing you
       * have to be told. `h` and `left` are where a hand already is after `j`/`k`.
       */
      const toFiles = () => {
        view = { ...view, pane: "files", anchor: undefined }
        draw()
      }

      /** Two panes, one keyboard: `tab` says which one `j` is talking to. */
      const swap = () => {
        view = { ...view, pane: view.pane === "diff" ? "files" : "diff" }
        if (view.pane === "diff" && view.line === undefined) view = { ...view, line: diffLinesOf()[0] }
        draw()
      }

      /** Enter on a folder folds it; on a file it opens it and moves you into the diff. */
      const enter = () => {
        /** In the diff, enter is "read this thread" when there is one to read. */
        if (view.pane === "diff") {
          const thread = hereThread()
          if (thread) {
            view = { ...view, reading: thread.id }
            draw()
          }
          return
        }
        const rows = navigableRows(store.current().changes, view)
        const row = rows.find((candidate) => candidate.path === view.cursor)
        if (!row) return
        if (row.kind === "file") {
          view = { ...view, file: row.path, scroll: 0, pane: "diff", line: undefined }
          view = { ...view, line: diffLinesOf()[0] }
        } else {
          const collapsed = new Set(view.collapsed ?? [])
          if (collapsed.has(row.path)) collapsed.delete(row.path)
          else collapsed.add(row.path)
          view = { ...view, collapsed }
        }
        draw()
      }

      /**
       * One key, and it comments on whatever the cursor is on: the selected lines, the line under the
       * cursor, or — in the file list — the file as a whole. Two keys for the same intention is two
       * keys to remember for no reason.
       */
      const comment = (whole = false) => {
        const file = view.file
        if (!file) return
        const onFile = whole || view.pane === "files"
        const from = onFile ? undefined : Math.min(view.anchor ?? view.line ?? 0, view.line ?? 0)
        const to = onFile ? undefined : Math.max(view.anchor ?? view.line ?? 0, view.line ?? 0)
        const existing = threadOn(review, file, from, to)

        /**
         * The review's keys are a *global* layer, so they are still live while a dialog is open — which
         * means typing a note would trigger them and `escape` would close the review out from under the
         * prompt. They go away for as long as the dialog is up.
         */
        dropKeys()

        askForNote(
          api,
          {
            title: existing
              ? `Reply · ${file}:${threadWhere(existing)}`
              : from === undefined
                ? `Note on ${file}`
                : to !== undefined && to > from
                  ? `Note on ${file}:${from}-${to}`
                  : `Note on ${file}:${from}`,
            description: existing
              ? "Continues the thread. Nothing is sent until you submit."
              : from === undefined
                ? "About the file as a whole. Nothing is sent until you submit."
                : "Nothing is sent until you submit the review.",
          },
          (body) => {
            const at = Date.now()
            review = existing
              ? say(review, existing.id, { author: "you", body, at })
              : openThread(
                  review,
                  {
                    file,
                    ...(from === undefined ? {} : { line: from }),
                    ...(to !== undefined && from !== undefined && to > from ? { through: to } : {}),
                    ...(quoteOf(file, from, to) ? { quoted: quoteOf(file, from, to) } : {}),
                  },
                  body,
                  "you",
                  at,
                )
            /** Written as it is said. A note you have to remember to save is a note you will lose. */
            keep(existing?.id ?? threadOn(review, file, from, to)?.id)
            view = { ...view, anchor: undefined }
            draw()
          },
          () => {
            /** However it closed, the keys come back and the pane is drawn again. */
            if (open) takeKeys()
            draw()
          },
        )
      }

      /** Starts a selection, or throws one away. The moving end is the cursor. */
      const selectRange = () => {
        view = view.anchor === undefined ? { ...view, anchor: view.line } : { ...view, anchor: undefined }
        draw()
      }

      /**
       * The thread under the cursor, which is what `r`, `o` and `x` act on.
       *
       * Derived rather than navigated: a thread lives on a line, so standing on the line is standing
       * on the thread. A second cursor for threads would be a second thing to move and to explain.
       */
      const hereThread = () => {
        if (!view.file) return undefined
        if (view.pane === "files")
          return threadsFor(review, view.file).find((each) => each.line === undefined)
        return view.line === undefined ? undefined : threadsOnLine(review, view.file, view.line)[0]
      }

      /**
       * Opens the thread under the cursor as a card, or closes the one that is open.
       *
       * One thread at a time, because a card is a thing you open and close — a rule with no edge
       * cases, unlike "which of these inline boxes is folded", which had several and cost a key that
       * appeared to do nothing.
       */
      const expand = () => {
        if (view.reading) {
          view = { ...view, reading: undefined }
          draw()
          return
        }
        const thread = hereThread()
        if (!thread) return
        view = { ...view, reading: thread.id }
        draw()
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
          {
            title: `Reply · ${thread.file}:${threadWhere(thread)}`,
            description:
              thread.status === "resolved"
                ? "Replying reopens this thread, so the agent sees it again."
                : "Continues the thread. Nothing is sent until you submit.",
          },
          (body) => {
            review = say(review, thread.id, { author: "you", body, at: Date.now() })
            keep(thread.id)
            draw()
          },
          () => {
            if (open) takeKeys()
            draw()
          },
        )
      }

      /** Throws a thread away. Resolving is what the agent does; this is what you do to a mistake. */
      const uncomment = () => {
        const thread = hereThread()
        if (!thread) return
        review = drop(review, thread.id)
        void persistence.remove(thread.id).catch(() => {})
        draw()
      }

      /**
       * A global layer, registered only while the review is open. A layer with a `target` matches the
       * *keymap host's* focused target, which stays the prompt whatever `focus()` sets on our own box —
       * so scoping by target silently never fires. Global means these letters are really taken, which
       * is why the layer is disposed the moment the review closes.
       */
      disposeKeys = api.keymap.registerLayer({
        priority: 100,
        commands: [
          { name: "cockpit.review.pane.down", title: "Down", run: () => move(1) },
          { name: "cockpit.review.pane.up", title: "Up", run: () => move(-1) },
          { name: "cockpit.review.pane.swap", title: "Switch pane", run: () => swap() },
          { name: "cockpit.review.pane.enter", title: "Open a file, or fold a folder", run: () => enter() },
          { name: "cockpit.review.pane.scrollDown", title: "Scroll down", run: () => scroll(5) },
          { name: "cockpit.review.pane.scrollUp", title: "Scroll up", run: () => scroll(-5) },
          {
            name: "cockpit.review.pane.comment",
            title: "Comment on this line or file",
            run: () => comment(),
          },
          {
            name: "cockpit.review.pane.commentFile",
            title: "Comment on the whole file",
            run: () => comment(true),
          },
          { name: "cockpit.review.pane.select", title: "Select lines", run: () => selectRange() },
          { name: "cockpit.review.pane.uncomment", title: "Remove the thread here", run: () => uncomment() },
          { name: "cockpit.review.pane.reply", title: "Reply to the thread here", run: () => replyHere() },
          { name: "cockpit.review.pane.expand", title: "Open or fold the thread here", run: () => expand() },
          { name: "cockpit.review.pane.files", title: "Back to the file list", run: () => toFiles() },
          {
            name: "cockpit.review.pane.read",
            title: "Mark read, and go to the next unread",
            run: () => {
              if (!view.file) return
              review = toggleRead(review, view.file)
              /** Marking a file read is meant to move you on; having to find the next one yourself is
               *  the part that makes people stop doing this. */
              if (isRead(review, view.file)) {
                const next = nextUnread(store.current().changes, review, view.file)
                if (next) view = { ...view, file: next, cursor: next, scroll: 0, line: undefined }
              }
              draw()
            },
          },
          {
            name: "cockpit.review.pane.source",
            title: "Next source (branch → worktree → session)",
            run: () => {
              store.setSource(SOURCES[(SOURCES.indexOf(store.source()) + 1) % SOURCES.length] ?? "branch")
              void refresh()
            },
          },
          { name: "cockpit.review.pane.reload", title: "Reload the diff", run: () => void refresh() },
          { name: "cockpit.review.pane.cycle", title: "Right pane or full screen", run: () => cycle() },
          {
            name: "cockpit.review.pane.quit",
            title: "Close the card, or the review",
            /**
             * Escape closes the nearest thing first. A key that shuts the whole review when you meant
             * to put a comment away is a key you stop trusting.
             */
            run: () => {
              if (view.reading) {
                view = { ...view, reading: undefined }
                draw()
                return
              }
              /** Deferred: closing disposes the layer this handler is dispatching through. */
              setTimeout(() => close(), 0)
            },
          },
        ],
        bindings: [
          { key: "j,down", cmd: "cockpit.review.pane.down", desc: "Down" },
          { key: "k,up", cmd: "cockpit.review.pane.up", desc: "Up" },
          { key: "tab", cmd: "cockpit.review.pane.swap", desc: "Switch pane" },
          { key: "return,l,right", cmd: "cockpit.review.pane.enter", desc: "Open or fold" },
          { key: "d,pagedown", cmd: "cockpit.review.pane.scrollDown", desc: "Scroll down" },
          { key: "u,pageup", cmd: "cockpit.review.pane.scrollUp", desc: "Scroll up" },
          { key: "c", cmd: "cockpit.review.pane.comment", desc: "Comment" },
          { key: "f", cmd: "cockpit.review.pane.commentFile", desc: "Comment on the file" },
          { key: "v", cmd: "cockpit.review.pane.select", desc: "Select lines" },
          { key: "h,left", cmd: "cockpit.review.pane.files", desc: "Back to the files" },
          { key: "x", cmd: "cockpit.review.pane.uncomment", desc: "Remove thread" },
          { key: "r", cmd: "cockpit.review.pane.reply", desc: "Reply" },
          { key: "o", cmd: "cockpit.review.pane.expand", desc: "Open or fold" },
          { key: "space,m", cmd: "cockpit.review.pane.read", desc: "Mark read" },
          { key: "s", cmd: "cockpit.review.pane.source", desc: "Next source" },
          { key: "g", cmd: "cockpit.review.pane.reload", desc: "Reload" },
          { key: "w", cmd: "cockpit.review.pane.cycle", desc: "Width" },
          { key: "q,escape", cmd: "cockpit.review.pane.quit", desc: "Close" },
        ],
      })
    }

    const dropKeys = () => {
      disposeKeys?.()
      disposeKeys = undefined
    }

    const close = () => {
      open = false
      clearInterval(watching)
      watching = undefined
      panel?.blur()
      dropKeys()
      draw()
      /** The prompt wants its cursor back, exactly where the host had it. */
      const at = api.renderer.getCursorState?.()
      if (at) api.renderer.setCursorPosition(at.x, at.y, true)
      else api.renderer.setCursorPosition(0, 0, true)
    }

    /**
     * Re-read the threads from disk while the review is open.
     *
     * The agent answers through the server half, which writes the same files — so the panel has to
     * find out somehow. Deliberately a re-read rather than a file watcher: a watcher can miss an
     * event for a file written and replaced within a tick, and a review that silently lags is worse
     * than one that costs a directory listing every second. Reconcile against what is on disk; never
     * trust an event stream to be complete.
     *
     * **Nothing moves.** Threads change colour under you; the cursor and the scroll stay exactly
     * where you left them. A panel that reorders itself while your eye is on a line is worse than one
     * that is briefly stale.
     */
    let watching: ReturnType<typeof setInterval> | undefined
    const reconcile = async () => {
      const threads = await persistence.load().catch(() => undefined)
      if (!threads) return
      const before = JSON.stringify(review.threads)
      if (JSON.stringify(threads) === before) return
      review = { ...review, threads }
      draw()
    }

    const show = () => {
      open = true
      panel?.focus()
      takeKeys()
      draw()
      void refresh()
      clearInterval(watching)
      watching = setInterval(() => void reconcile(), 1_500)
    }

    const toggle = () => (open ? close() : show())

    const cycle = () => {
      variant = VARIANTS[(VARIANTS.indexOf(variant) + 1) % VARIANTS.length] ?? "right"
      draw()
    }

    api.keymap.registerLayer({
      commands: [
        {
          name: "cockpit.review.open",
          title: "Review: open, or close it",
          category: "Review",
          namespace: "palette",
          // One slash name for the bay: `/review` and `/diff` are the host's, and `/changes` loses the
          // fuzzy match to `/review`'s own description.
          slashName: "cockreview",
          run: () => toggle(),
        },
        {
          name: "cockpit.review.place",
          title: "Review: right pane, or full screen",
          category: "Review",
          namespace: "palette",
          run: () => cycle(),
        },
        {
          name: "cockpit.review.hide",
          title: "Review: close",
          category: "Review",
          namespace: "palette",
          run: () => close(),
        },
      ],
      bindings: keys.gather("cockpit", Object.keys(DEFAULT_KEYS)),
    })

    api.slots.register({
      order: SLOT_ORDER,
      slots: {
        /**
         * Mounted once, hidden, and driven by assignment from here on. The slot function is called once
         * for its element — and so is everything it returns, props included.
         */
        app_bottom() {
          return (
            <Overlay
              api={api}
              onDismiss={() => {
                // Clicking off the panel dismisses it; at full width there is no "off" to click.
                if (variant !== "full") close()
              }}
              onClick={(x, y) => clickAt(x, y)}
              onScroll={(x, delta) => scrollAt(x, delta)}
              onReady={({ backdrop: back, panel: front, lines }) => {
                backdrop = back
                panel = front
                pool = createRowPool(lines)
                draw()
              }}
            />
          )
        },
      },
    })
  }
}

const plugin: TuiPluginModule & { id: string } = {
  id: "opencode-cockpit.review",
  tui: createReviewTui(),
}
export default plugin
