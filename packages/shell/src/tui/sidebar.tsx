/** @jsxImportSource @opentui/solid */
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createMemo, For, Show } from "solid-js"
import { Badge } from "./badge.tsx"
import type { ShellStore } from "./store.ts"
import { kindOf, shortDetail, truncate } from "./view.ts"

export function SidebarShells(props: { api: TuiPluginApi; store: ShellStore; onOpen: (id: string) => void }) {
  const theme = () => props.api.theme.current
  const counts = createMemo(() => {
    const list = props.store.shells()
    const running = list.filter((s) => kindOf(s) === "run").length
    const failed = props.store.visible().filter((s) => kindOf(s) === "fail").length
    return [running ? `${running} running` : "", failed ? `${failed} failed` : ""].filter(Boolean).join(" · ")
  })

  return (
    <Show when={props.store.shells().length > 0}>
      <box>
        <text fg={theme().text} wrapMode="none">
          <b>Shells</b>
          <span style={{ fg: theme().textMuted }}> {counts()}</span>
        </text>
        <For each={props.store.visible()}>
          {(shell) => (
            <box flexDirection="row" onMouseDown={() => props.onOpen(shell.id)}>
              <Badge api={props.api} shell={shell} frame={props.store.frame()} />
              <text fg={theme().text} wrapMode="none">
                {" "}
                {truncate(shell.title, 20)}{" "}
                <span style={{ fg: theme().textMuted }}>{shortDetail(shell, props.store.now())}</span>
              </text>
            </box>
          )}
        </For>
        <Show when={props.store.hidden().length > 0 || props.store.showAll()}>
          <text fg={theme().textMuted} onMouseDown={() => props.store.toggleAll()}>
            {props.store.showAll() ? "▾ show fewer" : `▸ ${props.store.hidden().length} more finished`}
          </text>
        </Show>
      </box>
    </Show>
  )
}
