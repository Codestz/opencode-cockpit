import type { SegmentConfig } from "./config.ts"
import type { StatusContext } from "./context.ts"

/**
 * A drawn piece of the line. `tone` names a theme colour rather than a literal, so the line
 * belongs to whatever theme the user runs.
 */
export type Tone =
  | "text"
  | "muted"
  | "accent"
  | "success"
  | "warning"
  | "error"
  | "info"
  /** The window's own background and panel colours — what a filled pill puts its text on. */
  | "background"
  | "panel"
  | "border"

/**
 * A styled piece of text. A segment is a list of these rather than one string, which is what lets
 * a single segment carry an icon in one colour, a figure in another, and a bar whose own cells are
 * coloured by what they represent.
 */
export interface Run {
  text: string
  tone?: Tone
  /** A literal `#rrggbb`, which wins over `tone`. */
  color?: string
  /** Background, for pills and filled bars. */
  bg?: string
  bgTone?: Tone
  bold?: boolean
  dim?: boolean
}

export interface Segment {
  id: string
  runs: Run[]
  /** Higher survives when the line is too long for the terminal. */
  priority: number
}

/** What a segment may return: one styled string, or several. */
export type Piece = { text: string; tone?: Tone; color?: string } | { runs: Run[] }

/**
 * A built-in. Returning `undefined` hides it, and that is the important half of the contract:
 * a segment whose input is missing must say nothing. A cost of "$0.00" on a provider nobody
 * declared prices for reads as "this was free", which is worse than an absent segment.
 */
export interface SegmentDef {
  name: string
  /** Used when the config does not override it. */
  priority: number
  /** Shown before the text when icons are on. */
  icon?: string
  render(ctx: StatusContext, config: SegmentConfig): Piece | undefined
}
