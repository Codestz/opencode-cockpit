/** @jsxImportSource @opentui/solid */
import type { JSX } from "solid-js"

/**
 * Plain text as an element OpenCode 1 can place in one of its dialogs.
 *
 * Its `DialogPrompt` takes a description as something to render, and renders it inside a box. Handed
 * a function that returns a *string*, it put bare text in the box, and OpenCode 1 stopped the whole
 * session: `Orphan text error: "…" must have a <text> as a parent`. Found by Subagents' message
 * dialog, the first to pass a plain description.
 */
export const textElement = (text: string) => (): JSX.Element => <text wrapMode="word">{text}</text>
