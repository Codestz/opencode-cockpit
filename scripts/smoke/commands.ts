/** Running a command the ways a person does: from the palette (`ctrl+p`), and by its slash name. */

import { expect, screen, type, until } from "./harness.ts"

/**
 * The palette, where a command can be listed and still do nothing you can see — Trust's "show or
 * hide in the sidebar" did exactly that. The capture's selection is not to be trusted blindly
 * (docs/building/testing.md), so the screen is read before `enter`: the entry has to be at the top,
 * right under the query.
 */
const atTop = (listed: string, query: string, title: string) => {
  const lines = listed.split("\n")
  const field = lines.findIndex((line) => line.trim() === query)
  return (
    field >= 0 &&
    lines
      .slice(field + 1)
      .filter((line) => line.trim())
      .slice(0, 2)
      .some((line) => line.includes(title))
  )
}

/**
 * The screen at rest, nothing open over it — taken before the first command runs. Each step waits
 * for the screen to come back to it: a command's toast ("No finished subagents to clear") still up
 * when `ctrl+p` was typed covered the palette, and the next step failed on v2. A line or two may
 * differ (a tip, a toggled sidebar); a toast or a dialog is more. Timed out, it goes on anyway, and
 * the palette check below says what was in the way.
 */
let quiet = ""
const atRest = (text: string) => {
  const was = quiet.split("\n")
  return text.split("\n").filter((line, y) => line !== was[y]).length <= 2
}
/** At rest: a beat after the last search's palette closed, the same screen twice running (or 5s). */
export async function settle(): Promise<void> {
  await Bun.sleep(1000)
  quiet = await until(5000, (text) => {
    const same = text === quiet
    quiet = text
    return same
  })
}

/** Types "cockpit <name>" into the palette: what it listed, closed again without running anything. */
export async function search(query: string): Promise<string> {
  await type("\x10", 1000)
  await type(query, 1500)
  const listed = await screen()
  await type("\x1b", 800)
  return listed
}

/** Runs `title` from the palette, once the screen is back at rest; what it drew after `waitMs`. */
export async function palette(title: string, waitMs = 2500): Promise<string> {
  await until(12_000, atRest)
  await type("\x10", 1000) // ctrl+p
  await type(title, 1500)
  const listed = await screen()
  expect(atTop(listed, title, title), `the palette did not offer "${title}" first`, listed)
  await type("\r", waitMs)
  return await screen()
}

/** `ready`: read as soon as it shows, for what does not stay — a toast the next one replaces. */
export async function slash(name: string, ready?: (text: string) => boolean): Promise<string> {
  await type(`/${name}`, 300)
  /** `enter` once the popup offers the name: with the agent busy it can take longer to list. */
  await until(4000, (text) => new RegExp(`/${name}\\s{2,}\\S`).test(text))
  await type("\r", ready ? 0 : 4000)
  const drawn = ready ? await until(4000, ready) : await screen()
  await type("\x1b", 1000)
  return drawn
}

/**
 * A command the agent side ships, which OpenCode runs as its own: on OpenCode 1 `enter` on the popup
 * first completes the name into the prompt, and a second `enter` sends it (measured, both versions).
 */
export async function shipped(name: string): Promise<void> {
  await type(`/${name}`, 300)
  await until(4000, (text) => new RegExp(`/${name}\\s{2,}\\S`).test(text))
  await type("\r", 1200)
  if (new RegExp(`┃\\s+/${name}\\s*$`, "m").test(await screen())) await type("\r", 0)
}

/**
 * The setup commands' slash names, shipped by the agent side, offered in the popup as they are typed
 * — once each: the interface's palette entries for them carry no slash name. Only listed here, not
 * run: running one asks a model, and a run without AGENT=1 stays offline.
 */
export async function popup(typed: string): Promise<string> {
  await type("\x15", 300)
  await type(typed, 1500)
  const listed = await screen()
  await type("\x15", 300)
  await type("\x1b", 800)
  return listed
}
/** How many rows of the popup offer `name`: at the popup's edge, the name, a gap, its description. */
export const offered = (listed: string, name: string) =>
  (listed.match(new RegExp(`┃ ${name} {2,}\\S`, "g")) ?? []).length
