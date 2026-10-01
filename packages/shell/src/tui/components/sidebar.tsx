/** @jsxImportSource @opentui/solid */
import type { Host } from "@opencode-cockpit/client/host"
import type { BoxRenderable } from "@opentui/core"
import { createMemo, createSignal, For, Show } from "solid-js"
import { sidebarCounts, sidebarRow } from "../lib/sidebar.ts"
import { kindColor, kindOf, watchColor } from "../lib/view.ts"
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

  const counts = createMemo(() => sidebarCounts(props.store.shells()))

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

  return (
    <Show when={props.store.shells().length > 0}>
      <box
        ref={(el: BoxRenderable) => {
          block = el
        }}
        onSizeChange={() => setResized((n) => n + 1)}
      >
        {/* A row of air under the heading, so the title reads as a heading and not as a list item. */}
        <text fg={theme().text} wrapMode="none" marginBottom={1}>
          <b>Shells</b>
          <span style={{ fg: theme().textMuted }}> {counts()}</span>
        </text>
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
        <Show when={overflow() > 0 || props.store.showAll()}>
          <text fg={theme().textMuted} wrapMode="none" onMouseUp={() => props.store.toggleAll()}>
            {props.store.showAll()
              ? overflow() > 0
                ? `▾ ${overflow()} more in ${props.consoleShortcut()} console`
                : "▾ show fewer"
              : `▸ ${overflow()} more`}
          </text>
        </Show>
      </box>
    </Show>
  )
}
