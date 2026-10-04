/** @jsxImportSource @opentui/solid */
import type { ColorInput } from "@opentui/core"
import type { JSX } from "solid-js"
import { EMPTY_TEXT } from "./design.ts"

/**
 * Plain text as an element OpenCode 1 can place in one of its dialogs.
 *
 * Its `DialogPrompt` takes a description as something to render, and renders it inside a box. Handed
 * a function that returns a *string*, it put bare text in the box, and OpenCode 1 stopped the whole
 * session: `Orphan text error: "…" must have a <text> as a parent`. Found by Subagents' message
 * dialog, the first to pass a plain description.
 */
export const textElement = (text: string) => (): JSX.Element => <text wrapMode="word">{text}</text>

/**
 * The `none yet` row of an empty sidebar block (`EMPTY_TEXT` in design.ts says why it is there), in
 * the theme's muted colour. Draw it in the slot of the first item — as the fallback of the block's
 * `<For>` over its rows — so the first item takes its place and the blocks below do not move. One
 * row, never wrapped: a wrapped empty line would be taller than the item that replaces it.
 */
export const EmptyRow = (props: { fg: ColorInput }): JSX.Element => (
  <text fg={props.fg} wrapMode="none">
    {EMPTY_TEXT}
  </text>
)
