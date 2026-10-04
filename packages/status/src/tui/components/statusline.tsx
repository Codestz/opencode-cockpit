/** @jsxImportSource @opentui/solid */

import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import type { Host } from "@opencode-cockpit/client/host"
import type { BoxRenderable } from "@opentui/core"
import type { JSX } from "solid-js"
import { For, Show } from "solid-js"
import type { Run, Segment, Tone } from "../../core/segments.ts"

/**
 * One line of segments, each segment a list of styled runs. Colour comes from the running theme
 * rather than literals, so the line belongs to whatever theme the user has chosen — a statusline
 * in someone else's palette is the first thing that makes a plugin look bolted on.
 */

/**
 * Theme colours are RGBA objects, and OpenTUI wants the object. Stringifying one yields garbage
 * that the renderer falls back to magenta on, which is how the whole line once came out pink.
 */
export type Colour = TuiThemeCurrent["text"]

export function toneColour(theme: TuiThemeCurrent, tone: Tone | undefined): Colour {
  switch (tone) {
    case "accent":
      return theme.accent
    case "success":
      return theme.success
    case "warning":
      return theme.warning
    case "error":
      return theme.error
    case "info":
      return theme.info
    case "muted":
      return theme.textMuted
    case "background":
      return theme.background
    case "panel":
      return theme.backgroundPanel
    case "border":
      return theme.borderSubtle
    default:
      return theme.text
  }
}

/** A run's own colour wins over its tone; a dim run falls back to the muted colour. */
function runStyle(theme: TuiThemeCurrent, run: Run) {
  const fg = run.color ?? toneColour(theme, run.dim ? "muted" : run.tone)
  const bg = run.bg ?? (run.bgTone ? toneColour(theme, run.bgTone) : undefined)
  return bg ? { fg, bg } : { fg }
}

/**
 * Emphasis is markup, not a style property.
 *
 * OpenTUI draws bold, italic and underline through `<b>`, `<i>` and `<u>` around the text — there
 * is no attribute to set. Passing one as a prop on the span type-checks and renders nothing at
 * all, which is how every attribute disappeared at once while the colours kept working.
 */
function decorate(run: Run): JSX.Element {
  let node: JSX.Element = run.text
  if (run.underline) node = <u>{node}</u>
  if (run.italic) node = <i>{node}</i>
  if (run.bold) node = <b>{node}</b>
  return node
}

export interface StatusLineProps {
  api: Host
  segments: () => Segment[]
  /** Rows above the line about the line itself — a setting to fix, a module that would not load. */
  notices?: () => Segment[]
  /** The line's box, once laid out, so a column can measure the room the host gave it. */
  onReady?: (box: BoxRenderable) => void
  separator: string
  /** Across the window, or down a column. */
  stack?: "horizontal" | "vertical"
  paddingLeft?: number
  paddingRight?: number
  paddingTop?: number
  paddingBottom?: number
}

/** One segment's runs, as one row of styled text. */
function Runs(props: { theme: TuiThemeCurrent; segment: Segment }) {
  return (
    <text wrapMode="none" flexShrink={0}>
      <For each={props.segment.runs}>
        {(run) => (
          <Show when={run.bold} fallback={<span style={runStyle(props.theme, run)}>{decorate(run)}</span>}>
            <span style={runStyle(props.theme, run)}>
              <b>{run.text}</b>
            </span>
          </Show>
        )}
      </For>
    </text>
  )
}

export function StatusLine(props: StatusLineProps) {
  const theme = () => props.api.theme.current
  const down = () => props.stack === "vertical"
  return (
    <box
      ref={(box: BoxRenderable) => props.onReady?.(box)}
      flexDirection="column"
      flexShrink={0}
      paddingLeft={props.paddingLeft ?? 1}
      paddingRight={props.paddingRight ?? 1}
      paddingTop={props.paddingTop ?? 0}
      paddingBottom={props.paddingBottom ?? 0}
    >
      {/* Their own rows, whichever way the line reads: a sentence does not fit between two segments. */}
      <For each={props.notices?.() ?? []}>{(notice) => <Runs theme={theme()} segment={notice} />}</For>
      <box flexDirection={down() ? "column" : "row"} flexShrink={0}>
        <For each={props.segments()}>
          {(segment, index) => (
            <>
              <Show when={index() > 0 && !down() && props.separator.length > 0}>
                <text fg={theme().borderSubtle} wrapMode="none" flexShrink={0}>
                  {props.separator}
                </text>
              </Show>
              <Runs theme={theme()} segment={segment} />
            </>
          )}
        </For>
      </box>
    </box>
  )
}
