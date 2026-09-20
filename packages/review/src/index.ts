/**
 * Published entry point for a standalone install: `@opencode-cockpit/review`.
 *
 * OpenCode loads a plugin's halves separately — `./server` beside its own server, `./tui` in the
 * interface thread — so this only exists to give the package a default the way the others do.
 */
export { createReviewServer as default, REVIEW_PACKAGE } from "./agent/plugin.ts"
