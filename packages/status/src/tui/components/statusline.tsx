/** @jsxImportSource @opentui/solid */

import type { TuiPluginApi, TuiThemeCurrent } from "@opencode-ai/plugin/tui"
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

export interface StatusLineProps {
  api: TuiPluginApi
  segments: () => Segment[]
  separator: string
  /** Across the window, or down a column. */
  stack?: "horizontal" | "vertical"
  paddingLeft?: number
  paddingRight?: number
  paddingTop?: number
  paddingBottom?: number
}

export function StatusLine(props: StatusLineProps) {
  const theme = () => props.api.theme.current
  const down = () => props.stack === "vertical"
  return (
    <box
      flexDirection={down() ? "column" : "row"}
      flexShrink={0}
      paddingLeft={props.paddingLeft ?? 1}
      paddingRight={props.paddingRight ?? 1}
      paddingTop={props.paddingTop ?? 0}
      paddingBottom={props.paddingBottom ?? 0}
    >
      <For each={props.segments()}>
        {(segment, index) => (
          <>
            <Show when={index() > 0 && !down() && props.separator.length > 0}>
              <text fg={theme().borderSubtle} wrapMode="none" flexShrink={0}>
                {props.separator}
              </text>
            </Show>
            <text wrapMode="none" flexShrink={0}>
              <For each={segment.runs}>
                {(run) => (
                  <Show when={run.bold} fallback={<span style={runStyle(theme(), run)}>{run.text}</span>}>
                    <span style={runStyle(theme(), run)}>
                      <b>{run.text}</b>
                    </span>
                  </Show>
                )}
              </For>
            </text>
          </>
        )}
      </For>
    </box>
  )
}
