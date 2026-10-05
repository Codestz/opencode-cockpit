/**
 * Status's settings: the `status` section of the files every cockpit bay reads, through the one
 * loader in `@opencode-cockpit/client/settings`:
 *
 *   ~/.config/opencode-cockpit/config.json  →  <project>/.cockpit.json  →  plugin-entry options
 *
 * Only `status` is read: not `statusline` (the section's name until 0.9), not keys at the file's
 * root. A top-level name nothing reads is a `!` row; a file that cannot be parsed is a notice too,
 * never the end of the interface.
 */

export {
  applyOverride,
  asSegmentConfig,
  DEFAULT_SEGMENTS,
  DEFAULT_SEPARATOR,
  PRESETS,
  type ResolvedLine,
  resolveLines,
  SIDEBAR_SEGMENTS,
} from "./lines.ts"
export { type LoadedStatus, loadStatus, type StatusInput, statusNotices } from "./load.ts"
export { configNotices, configProblems, type StatusProblem } from "./problems.ts"
export {
  type CommandConfig,
  DEFAULT_SURFACE,
  KINDS,
  type LineConfig,
  type Override,
  type SegmentChange,
  type SegmentConfig,
  type Stack,
  type StatusConfig,
  type Surface,
} from "./shape.ts"
