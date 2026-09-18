/** @jsxImportSource @opentui/solid */
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, For, Show } from "solid-js"
import { Badge } from "./badge.tsx"
import type { ShellStore } from "./store.ts"
import { useScreen } from "./store.ts"
import {
  displayCommand,
  kindColor,
  kindOf,
  statusDetail,
  tailLines,
  truncate,
  watchColor,
  watchLabel,
} from "./view.ts"

export interface DockProps {
  api: TuiPluginApi
  store: ShellStore
  height: number
  hint: () => string
  onOpenConsole: (id: string) => void
}

/** Split pane under the chat: status tabs for shells and the selected shell's live screen. */
export function Dock(props: DockProps) {
  const theme = () => props.api.theme.current
  const dims = useTerminalDimensions()
  const { screen } = useScreen(props.store, () => props.store.selected()?.id)
  const bodyRows = () => Math.max(2, props.height - 3)
  // Tabs share one row: keep them to what fits, the rest lives behind the "N more" chip.
  const tabLimit = () => Math.max(1, Math.floor((dims().width - 26) / 30))
  const tabs = createMemo(() =>
    (props.store.showAll() ? props.store.shells() : props.store.visible()).slice(0, tabLimit()),
  )
  const overflow = createMemo(() => props.store.shells().length - tabs().length)
  const body = createMemo(() => tailLines(screen()?.text, bodyRows(), Math.max(10, dims().width - 4)))

  return (
    <box
      height={props.height}
      flexShrink={0}
      flexDirection="column"
      border={["top"]}
      borderColor={theme().border}
      backgroundColor={theme().backgroundPanel}
    >
      <box
        flexDirection="row"
        gap={1}
        paddingLeft={1}
        paddingRight={1}
        flexShrink={0}
        height={1}
        overflow="hidden"
      >
        <text fg={theme().text} flexShrink={0}>
          <b>Shells</b>
        </text>
        <Show
          when={props.store.shells().length > 0}
          fallback={
            <text fg={theme().textMuted} wrapMode="none">
              none yet · the agent starts them, or /shell-new
            </text>
          }
        >
          <For each={tabs()}>
            {(shell) => {
              const active = () => props.store.selected()?.id === shell.id
              return (
                <box
                  flexDirection="row"
                  flexShrink={0}
                  paddingRight={1}
                  backgroundColor={active() ? theme().backgroundElement : theme().backgroundPanel}
                  onMouseUp={() => (active() ? props.onOpenConsole(shell.id) : props.store.select(shell.id))}
                >
                  <Badge api={props.api} shell={shell} frame={props.store.frame()} />
                  <text fg={active() ? theme().text : theme().textMuted} wrapMode="none">
                    {" "}
                    {active() ? <b>{truncate(shell.title, 22)}</b> : truncate(shell.title, 22)}
                  </text>
                </box>
              )
            }}
          </For>
          <Show when={overflow() > 0 || props.store.showAll()}>
            <text
              fg={theme().textMuted}
              wrapMode="none"
              flexShrink={0}
              onMouseUp={() => props.store.toggleAll()}
            >
              {props.store.showAll() ? "▾ fewer" : `▸ ${overflow()} more`}
            </text>
          </Show>
        </Show>
        <box flexGrow={1} />
        <text fg={theme().textMuted} wrapMode="none" flexShrink={0}>
          {props.hint()}
        </text>
      </box>
      <Show when={props.store.selected()}>
        {(shell) => (
          <>
            <box
              flexGrow={1}
              paddingLeft={2}
              paddingRight={1}
              minHeight={0}
              overflow="hidden"
              onMouseUp={() => props.onOpenConsole(shell().id)}
            >
              <text fg={theme().text} wrapMode="none">
                {body() || " "}
              </text>
            </box>
            <box flexDirection="row" gap={1} paddingLeft={2} flexShrink={0} height={1} overflow="hidden">
              <text fg={kindColor(theme(), kindOf(shell()))} wrapMode="none" flexShrink={0}>
                {statusDetail(shell(), props.store.now())}
              </text>
              <Show when={watchLabel(shell())}>
                <text fg={watchColor(theme(), shell())} wrapMode="none" flexShrink={0}>
                  {watchLabel(shell())}
                </text>
              </Show>
              <Show
                when={kindOf(shell()) === "fail" && shell().summary}
                fallback={
                  <text fg={theme().textMuted} wrapMode="none">
                    {truncate(`$ ${displayCommand(shell())}`, Math.max(20, dims().width - 40))}
                  </text>
                }
              >
                <text fg={theme().error} wrapMode="none">
                  {truncate(`${shell().summary}`, Math.max(20, dims().width - 40))}
                </text>
              </Show>
            </box>
          </>
        )}
      </Show>
    </box>
  )
}
