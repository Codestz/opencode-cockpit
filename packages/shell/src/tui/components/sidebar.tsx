/** @jsxImportSource @opentui/solid */
import {
  emptyBlock,
  FEWER_TEXT,
  HEADING_GAP,
  moreText,
  type State,
  summaryRuns,
  type ToneRun,
  warnRows,
} from "@opencode-cockpit/client/design"
import type { Host } from "@opencode-cockpit/client/host"
import { blockWidth } from "@opencode-cockpit/client/sidebar"
import type { BoxRenderable } from "@opentui/core"
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { fold, sidebarRow } from "../lib/sidebar.ts"
import { kindColor, kindOf, STATE, toneColor, watchColor } from "../lib/view.ts"
import type { ShellStore } from "../state/store.ts"

export interface SidebarProps {
  api: Host
  store: ShellStore
  /** Rows shown before the rest folds away; the sidebar is a narrow, shared column. */
  rows?: number
  /** Rows shown while expanded, so a hundred shells can never push the sidebar over. */
  expandedRows?: number
  /** Draw nothing at all while there are no shells (`hideWhenEmpty`); else the heading and `none yet`. */
  hideWhenEmpty?: boolean
  /** Settings to fix, one `!` row each (client/settings `noticeText`); they show even when empty and hidden. */
  notices?: readonly string[]
  onOpen: (id: string) => void
  consoleShortcut: () => string
}

/** Rows a settings notice may wrap to: its last words are the fix, and a narrow column needs four. */
const NOTICE_ROWS = 5

export function SidebarShells(props: SidebarProps) {
  const theme = () => props.api.theme.current

  /**
   * Every count, in the words and tones the Subagents heading uses beside it (client/design): it read
   * `7 done` in one block and `2 run · 1 fail` in this one. Sized from the measured width below, less
   * the name: a fourth count gives way, never what is running or failed.
   */
  const tally = createMemo(() => {
    const out: Partial<Record<State, number>> = {}
    for (const shell of props.store.shells()) {
      const state = STATE[kindOf(shell)]
      out[state] = (out[state] ?? 0) + 1
    }
    return out
  })

  /** Running shells and recent failures first; everything else only when expanded (`fold`). */
  const folding = createMemo(() =>
    fold({
      all: props.store.shells(),
      folded: props.store.folded(),
      showAll: props.store.showAll(),
      rows: props.rows ?? 5,
      expandedRows: props.expandedRows ?? 12,
    }),
  )
  /** Expanded for a list that fits folded now: fold back, so the next time it overflows it starts folded. */
  createEffect(() => {
    if (folding().stale) props.store.foldAll()
  })

  /**
   * The width the sidebar gives the block, so each row can be exactly that wide and its facts flush
   * right. Measured off the container rather than the block, as Subagents does: rows wider than the
   * sidebar stretch the block with them, so its own width would only ever agree with the guess.
   * Re-read on every tick as well as on a resize, since a sidebar dragged wider tells nothing inside
   * it. Before the first layout, a guess on the narrow side: a row too short leaves its facts a few
   * columns from the edge, and a row too long loses them off it.
   */
  let block: BoxRenderable | undefined
  const [resized, setResized] = createSignal(0)
  const width = createMemo(() => {
    props.store.now()
    resized()
    return blockWidth(block, props.api.renderer.width, 30)
  })

  const counts = createMemo(() => summaryRuns(tally(), Math.max(8, width() - "Shells ".length)))
  const warnings = createMemo(() =>
    (props.notices ?? []).flatMap((text) => warnRows(text, width(), NOTICE_ROWS)),
  )
  const empty = () => props.store.shells().length === 0
  /**
   * With no shells the block still says it exists — the heading, and `none yet` in the row the first
   * shell will take — unless asked for silence; a notice always speaks.
   */
  const emptyRows = createMemo(() =>
    emptyBlock("Shells", width(), props.hideWhenEmpty === true && warnings().length === 0),
  )

  /** Rows the shared design module drew, coloured here: the empty block, and the notices. */
  const toneRows = (rows: () => readonly ToneRun[][]) => (
    <For each={rows()}>
      {(row) => (
        <text wrapMode="none">
          <For each={row}>
            {(run) => (
              <span style={{ fg: toneColor(theme(), run.tone ?? "text") }}>
                {run.bold ? <b>{run.text}</b> : run.text}
              </span>
            )}
          </For>
        </text>
      )}
    </For>
  )

  return (
    <Show when={!empty() || emptyRows().length > 0}>
      <box
        ref={(el: BoxRenderable) => {
          block = el
        }}
        onSizeChange={() => setResized((n) => n + 1)}
      >
        <Show
          when={!empty()}
          fallback={
            <>
              {toneRows(emptyRows)}
              {toneRows(warnings)}
            </>
          }
        >
          {/*
           * The title on the left and what needs your eye flush right, as the Subagents heading draws
           * it; then the row of air every block has under its heading.
           */}
          <box flexDirection="row" marginBottom={HEADING_GAP}>
            <text fg={theme().text} wrapMode="none" flexShrink={0}>
              <b>Shells</b>
            </text>
            <box flexGrow={1} />
            <text wrapMode="none" flexShrink={0}>
              <For each={counts()}>
                {(part) => <span style={{ fg: toneColor(theme(), part.tone ?? "muted") }}>{part.text}</span>}
              </For>
            </text>
          </box>
          <For each={folding().shown}>
            {(shell) => {
              const row = () => sidebarRow(shell, props.store.now(), props.store.frame(), width())
              const colour = () => kindColor(theme(), kindOf(shell))
              return (
                // Mouse-up, not mouse-down: the host dialog closes on the mouse-up that follows, so
                // opening the console on press would need the button held down.
                <text fg={theme().text} wrapMode="none" onMouseUp={() => props.onOpen(shell.id)}>
                  <span style={{ fg: colour() }}>{row().rule}</span>
                  <span style={{ fg: colour() }}>
                    <b>{row().label}</b>
                  </span>
                  {row().title}
                  <span style={{ fg: watchColor(theme(), shell) }}>{row().watch}</span>
                  <span style={{ fg: theme().textMuted }}>{row().detail}</span>
                </text>
              )
            }}
          </For>
          {/*
           * Said as the Subagents block says it (`+ 3 more`), under the names rather than under the
           * marks; a click still unfolds it here, and folds it back. Only while folding hides
           * something: one shell has nothing to fold.
           */}
          <Show when={folding().toggle}>
            {(toggle) => (
              <text fg={theme().textMuted} wrapMode="none" onMouseUp={() => props.store.toggleAll()}>
                {toggle() === "more"
                  ? `  ${moreText(folding().more)}`
                  : toggle() === "both"
                    ? `  ${moreText(folding().more)} · ${props.consoleShortcut()} console`
                    : `  ${FEWER_TEXT}`}
              </text>
            )}
          </Show>
          {toneRows(warnings)}
        </Show>
      </box>
    </Show>
  )
}
