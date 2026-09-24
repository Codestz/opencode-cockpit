/** @jsxImportSource @opentui/solid */
import type { Host } from "@opencode-cockpit/client/host"
import { For } from "solid-js"
import type { Row } from "../lib/console.ts"
import { fillColour, toneColour } from "../view/pool.ts"

type Layer = Parameters<Host["keymap"]["registerLayer"]>[0]

export interface ConsoleProps {
  api: Host
  /** The console's rows at the dialog's size — the same rows full screen draws, smaller. */
  rows: () => Row[]
  /**
   * The console's one key table (`panel/keys.ts`). Registered from inside the dialog: while the
   * host's dialog is open it takes the keys, so a global layer never hears them.
   */
  keys: () => Layer
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
  /** Owned by this component, so the keys go when the dialog does — on either OpenCode. */
  props.api.keymap.useLayer(props.keys)
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
