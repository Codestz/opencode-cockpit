/** @jsxImportSource @opentui/solid */
import type { Host, Layer } from "@opencode-cockpit/client/host"
import type { JSX } from "solid-js"
import type { Row } from "../../core/view/rows.ts"
import { Rows } from "./rows.tsx"

export interface LedgerProps {
  api: Host
  rows: () => readonly Row[]
  /**
   * The dialog's letters. Registered from inside the dialog, as Shell's console does: while the host's
   * dialog is open it takes the keys, so a global layer would never hear them, and a layer owned by
   * the component goes when the dialog does — on either OpenCode.
   */
  keys: () => Layer
}

/** The ledger in the host's dialog: rows from `core/view/ledger.ts`, and the keys that act on them. */
export function Ledger(props: LedgerProps): JSX.Element {
  props.api.keymap.useLayer(props.keys)
  return <Rows api={props.api} rows={props.rows} />
}
