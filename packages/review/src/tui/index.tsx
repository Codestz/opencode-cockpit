/** @jsxImportSource @opentui/solid */

import { createBindingLookup, type TuiPlugin, type TuiPluginModule } from "@opencode-ai/plugin/tui"
import { claimFeature, duplicateFeatureMessage } from "@opencode-cockpit/client/feature"
import type { BoxRenderable } from "@opentui/core"
import {
  addNote,
  emptyReview,
  isRead,
  nextUnread,
  notesFor,
  type Review,
  removeNote,
  type Source,
  toggleRead,
} from "../core/model/review.ts"
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
    let view: ViewState = { context: 3, collapsed: new Set() }
    /** Where the list starts on screen, so a click can be turned into a row. */
    const listTop = () => (panel?.y ?? 0) + 1 + HEADER_ROWS
    /** How many rows of it are visible, which both scrolling and clicking need to agree on. */
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
      await store.load()
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
      /**
       * Only the file list answers to a click.
       *
       * The diff side is going to grow its own meanings for a click — put a note on this line, start a
       * selection — and a click that quietly moved the file list instead would be the wrong thing
       * happening somewhere you were not looking.
       */
      if (columns.list === 0 || x > panel.x + columns.list) return

      const rows = navigableRows(store.current().changes, view)
      if (rows.length === 0) return
      const height = Math.max(1, panel.height - 2 - HEADER_ROWS - FOOTER_ROWS)
      const index = y - listTop() + listScroll(store.current().changes, view, height)
      const row = rows[index]
      if (!row) return

      view = { ...view, cursor: row.path }
      if (row.kind === "file") {
        view = { ...view, file: row.path, scroll: 0 }
      } else {
        const collapsed = new Set(view.collapsed ?? [])
        if (collapsed.has(row.path)) collapsed.delete(row.path)
        else collapsed.add(row.path)
        view = { ...view, collapsed }
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
        view = { ...view, line: next }
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

      /** Two panes, one keyboard: `tab` says which one `j` is talking to. */
      const swap = () => {
        view = { ...view, pane: view.pane === "diff" ? "files" : "diff" }
        if (view.pane === "diff" && view.line === undefined) view = { ...view, line: diffLinesOf()[0] }
        draw()
      }

      /** Enter on a folder folds it; on a file it opens it and moves you into the diff. */
      const enter = () => {
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
        const existing = notesFor(review, file).find((note) => note.line === from)

        /**
         * The review's keys are a *global* layer, so they are still live while a dialog is open — which
         * means typing a note would trigger them and `escape` would close the review out from under the
         * prompt. They go away for as long as the dialog is up.
         */
        dropKeys()

        askForNote(
          api,
          {
            title:
              from === undefined
                ? `Note on ${file}`
                : to !== undefined && to > from
                  ? `Note on ${file}:${from}-${to}`
                  : `Note on ${file}:${from}`,
            description:
              from === undefined
                ? "About the file as a whole. Nothing is sent until you submit."
                : "Nothing is sent until you submit the review.",
            ...(existing ? { value: existing.body } : {}),
          },
          (body) => {
            const quoted = quoteOf(file, from, to)
            review = addNote(review, {
              file,
              ...(from === undefined ? {} : { line: from }),
              ...(to !== undefined && from !== undefined && to > from ? { through: to } : {}),
              body,
              ...(quoted ? { quoted } : {}),
            })
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

      /** A second thought can also be no thought at all. */
      const uncomment = () => {
        if (!view.file) return
        review = removeNote(review, view.file, view.pane === "diff" ? view.line : undefined)
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
          { name: "cockpit.review.pane.uncomment", title: "Remove the note here", run: () => uncomment() },
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
          { name: "cockpit.review.pane.reload", title: "Reload", run: () => void refresh() },
          { name: "cockpit.review.pane.cycle", title: "Right pane or full screen", run: () => cycle() },
          {
            name: "cockpit.review.pane.quit",
            title: "Close the review",
            /** Deferred: closing disposes the layer this handler is dispatching through. */
            run: () => setTimeout(() => close(), 0),
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
          { key: "x", cmd: "cockpit.review.pane.uncomment", desc: "Remove note" },
          { key: "space,m", cmd: "cockpit.review.pane.read", desc: "Mark read" },
          { key: "s", cmd: "cockpit.review.pane.source", desc: "Next source" },
          { key: "r", cmd: "cockpit.review.pane.reload", desc: "Reload" },
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
      panel?.blur()
      dropKeys()
      draw()
    }

    const show = () => {
      open = true
      panel?.focus()
      takeKeys()
      draw()
      void refresh()
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
