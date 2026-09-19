/**
 * The public surface a statusline module writes against, published as
 * `@opencode-cockpit/status/segment`.
 *
 *   import type { StatusContext, CustomModule } from "@opencode-cockpit/status/segment"
 *
 * Everything here is a type or a pure helper: a module never touches OpenCode's plugin api, only
 * the snapshot it is handed. That is what makes a custom segment as testable as a built-in.
 */

export type { ClaudeCodeStatusInput } from "./claude-code.ts"
export type { SegmentConfig } from "./config.ts"
export type {
  ServiceSnapshot,
  SessionSnapshot,
  StatusContext,
  TokenCounts,
} from "./context.ts"
export { contextRatio, contextUsed, todoRemaining, unhealthy } from "./context.ts"
export type { CustomModule, CustomRender } from "./custom.ts"
export {
  bar,
  basename,
  compact,
  duration,
  gradient,
  money,
  percent,
  preciseDuration,
  shortModel,
  shortPath,
  truncate,
  truncateStart,
} from "./format.ts"
export type { Piece, Run, Segment, SegmentDef, Tone } from "./segments.ts"
export { cutSegment, runsOf, segmentText, segmentWidth } from "./segments.ts"
