/** @jsxImportSource @opentui/solid */
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createMemo, For, Show } from "solid-js"
import { kindOf, shortDetail, truncate, watchColor, watchLabel } from "../lib/view.ts"
import type { ShellStore } from "../state/store.ts"
import { Badge } from "./badge.tsx"

export interface SidebarProps {
  api: TuiPluginApi
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

  const counts = createMemo(() => {
    const list = props.store.shells()
    const of = (kind: string) => list.filter((s) => kindOf(s) === kind).length
    // The sidebar column is ~26 characters wide; keep the summary short enough to survive it.
    return [
      of("run") ? `${of("run")} run` : "",
      of("fail") ? `${of("fail")} fail` : "",
      of("done") + of("stop") ? `${of("done") + of("stop")} done` : "",
    ]
      .filter(Boolean)
      .join(" · ")
  })

  // Running shells and recent failures first; everything else only when expanded.
  const candidates = createMemo(() => (props.store.showAll() ? props.store.shells() : props.store.visible()))
  const shown = createMemo(() => candidates().slice(0, limit()))
  const overflow = createMemo(() => props.store.shells().length - shown().length)

  return (
    <Show when={props.store.shells().length > 0}>
      <box>
        {/* A row of air under the heading, so the title reads as a heading and not as a list item. */}
        <text fg={theme().text} wrapMode="none" marginBottom={1}>
          <b>Shells</b>
          <span style={{ fg: theme().textMuted }}> {counts()}</span>
        </text>
        <For each={shown()}>
          {(shell) => (
            // Mouse-up, not mouse-down: the host dialog closes on the mouse-up that follows, so
            // opening the console on press would need the button held down.
            <box flexDirection="row" onMouseUp={() => props.onOpen(shell.id)}>
              <Badge api={props.api} shell={shell} frame={props.store.frame()} />
              <text fg={theme().text} wrapMode="none">
                {" "}
                {truncate(shell.title, 20)}{" "}
                <span style={{ fg: theme().textMuted }}>{shortDetail(shell, props.store.now())}</span>
                <Show when={watchLabel(shell)}>
                  <span style={{ fg: watchColor(theme(), shell) }}> {watchLabel(shell)}</span>
                </Show>
              </text>
            </box>
          )}
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
