/**
 * The public surface a statusline module writes against, published as
 * `@opencode-cockpit/status/segment`.
 *
 *   import type { StatusContext, CustomModule } from "@opencode-cockpit/status/segment"
 *
 * Everything here is a type or a pure helper: a module never touches OpenCode's plugin api, only
 * the snapshot it is handed. That is what makes a custom segment as testable as a built-in.
 */

/**
 * The gauge rule every bay draws a level with — calm, then the warning, then the error, at two
 * documented thresholds — so a module's bar reads the way the built-in one does.
 */
export { GAUGE, gaugeTone } from "@opencode-cockpit/client/design"
export type { ClaudeCodeStatusInput } from "./claude-code.ts"
export type { SegmentConfig } from "./config/index.ts"
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
