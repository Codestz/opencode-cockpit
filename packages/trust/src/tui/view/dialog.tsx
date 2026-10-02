/** @jsxImportSource @opentui/solid */
// biome-ignore-all lint/a11y/noStaticElementInteractions: these are terminal boxes, not DOM elements
import type { Host, Layer } from "@opencode-cockpit/client/host"
import type { BoxRenderable, MouseEvent } from "@opentui/core"
import type { JSX } from "solid-js"
import type { Row } from "../../core/view/rows.ts"
import { Rows } from "./rows.tsx"

export interface DialogProps {
  api: Host
  rows: () => readonly Row[]
  /**
   * The dialog's keys. Registered from inside the dialog, as Shell's console does: while the host's
   * dialog is open it takes the keys, so a global layer would never hear them, and a layer owned by
   * the component goes when the dialog does — on either OpenCode.
   */
  keys: () => Layer
  /** The wheel moves the cursor, three rows a notch, and the list follows it as `j`/`k` do. */
  onScroll: (by: number) => void
  /** A click, in the rows' own cells: column and row from their top-left corner. */
  onClick: (x: number, y: number) => void
}

/**
 * Trust's dialog in the host's: rows from `core/view/` — the activity or the ledger — and the keys and
 * clicks that act on them. Clicks are read on release: on press, anything a click opens is up in time
 * to catch the release and take it for its own (Review's overlay learned this).
 */
export function Dialog(props: DialogProps): JSX.Element {
  props.api.keymap.useLayer(props.keys)
  let rows: BoxRenderable | undefined
  return (
    <box
      onMouse={(event: MouseEvent) => {
        const scroll = event.scroll
        if (!scroll) return
        event.stopPropagation()
        props.onScroll(scroll.direction === "up" ? -3 : 3)
      }}
      onMouseUp={(event: MouseEvent) => {
        if (!rows) return
        event.stopPropagation()
        props.onClick(event.x - rows.x, event.y - rows.y)
      }}
    >
      <Rows
        api={props.api}
        rows={props.rows}
        onReady={(box) => {
          rows = box
        }}
      />
    </box>
  )
}
