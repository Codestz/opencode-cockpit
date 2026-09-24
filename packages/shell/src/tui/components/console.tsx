/** @jsxImportSource @opentui/solid */
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { useBindings } from "@opentui/keymap/solid"
import { For } from "solid-js"
import type { Row } from "../lib/console.ts"
import { fillColour, toneColour } from "../view/pool.ts"

/** The shared table's commands and bindings, and when they apply — all `useBindings` needs. */
export interface DialogKeys {
  commands: Layer["commands"]
  bindings: Layer["bindings"]
  enabled: () => boolean
}
type Layer = Parameters<TuiPluginApi["keymap"]["registerLayer"]>[0]

export interface ConsoleProps {
  api: TuiPluginApi
  /** The console's rows at the dialog's size — the same rows full screen draws, smaller. */
  rows: () => Row[]
  /**
   * The console's one key table (`panel/keys.ts`). Registered from inside the dialog: while the
   * host's dialog is open it takes the keys, so a global layer never hears them.
   */
  keys: () => DialogKeys
}

/**
 * The console in the host's dialog: a renderer of `consoleRows`, and nothing else.
 *
 * Everything the console knows and does lives in `panel/` and `lib/console.ts`, shared with full
 * screen — this only puts rows on screen, coloured by the same table the full-screen pool uses. The
 * dialog is the one place a component re-renders, so `rows` is read reactively here.
 */
export function Console(props: ConsoleProps) {
  const theme = () => props.api.theme.current
  useBindings(() => {
    const keys = props.keys()
    return { commands: keys.commands, bindings: keys.bindings, enabled: keys.enabled } as Parameters<
      typeof useBindings
    >[0] extends () => infer L
      ? L
      : never
  })
  return (
    <box flexDirection="column" overflow="hidden">
      <For each={props.rows()}>
        {(row) => (
          <text wrapMode="none">
            <For each={row}>
              {(run) => (
                <span
                  style={{
                    fg: run.fg ?? toneColour(theme(), run.tone),
                    ...((run.bg ?? fillColour(theme(), run))
                      ? { bg: run.bg ?? fillColour(theme(), run) }
                      : {}),
                    bold: Boolean(run.bold),
                  }}
                >
                  {run.text}
                </span>
              )}
            </For>
          </text>
        )}
      </For>
    </box>
  )
}
