/** @jsxImportSource @opentui/solid */
import { FEWER_TEXT, moreText, type State, summaryRuns } from "@opencode-cockpit/client/design"
import type { Host } from "@opencode-cockpit/client/host"
import type { BoxRenderable } from "@opentui/core"
import { createMemo, createSignal, For, Show } from "solid-js"
import { sidebarRow } from "../lib/sidebar.ts"
import { kindColor, kindOf, STATE, toneColor, watchColor } from "../lib/view.ts"
import type { ShellStore } from "../state/store.ts"

export interface SidebarProps {
  api: Host
  store: ShellStore
  /** Rows shown before the rest folds away; the sidebar is a narrow, shared column. */
  rows?: number
  /** Rows shown while expanded, so a hundred shells can never push the sidebar over. */
  expandedRows?: number
  onOpen: (id: string) => void
  consoleShortcut: () => string
}

export function SidebarShells(props: SidebarProps) {
  const theme = () => props.api.theme.current
  const limit = () => Math.max(1, props.store.showAll() ? (props.expandedRows ?? 12) : (props.rows ?? 5))

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

  // Running shells and recent failures first; everything else only when expanded.
  const candidates = createMemo(() => (props.store.showAll() ? props.store.shells() : props.store.visible()))
  const shown = createMemo(() => candidates().slice(0, limit()))
  const overflow = createMemo(() => props.store.shells().length - shown().length)

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
    const parent = (block?.parent as { width?: number } | null | undefined)?.width ?? 0
    const own = block?.width ?? 0
    const measured = parent >= 12 ? Math.min(parent, own >= 12 ? own : parent) : own
    return measured >= 12
      ? measured
      : Math.max(20, Math.min(30, Math.floor(props.api.renderer.width / 4) - 2))
  })

  const counts = createMemo(() => summaryRuns(tally(), Math.max(8, width() - "Shells ".length)))

  return (
    <Show when={props.store.shells().length > 0}>
      <box
        ref={(el: BoxRenderable) => {
          block = el
        }}
        onSizeChange={() => setResized((n) => n + 1)}
      >
        {/*
         * The title on the left and what needs your eye flush right, as the Subagents heading draws
         * it; and no row of air under it, as no other block in the sidebar has one.
         */}
        <box flexDirection="row">
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
        <For each={shown()}>
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
         * marks; a click still unfolds it here, and folds it back.
         */}
        <Show when={overflow() > 0 || props.store.showAll()}>
          <text fg={theme().textMuted} wrapMode="none" onMouseUp={() => props.store.toggleAll()}>
            {props.store.showAll()
              ? overflow() > 0
                ? `  ${moreText(overflow())} · ${props.consoleShortcut()} console`
                : `  ${FEWER_TEXT}`
              : `  ${moreText(overflow())}`}
          </text>
        </Show>
      </box>
    </Show>
  )
}
