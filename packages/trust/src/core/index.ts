/** Published entry point: `@opencode-cockpit/trust/core` — the pure half, no OpenCode, no terminal. */
export { dangerous } from "./danger.ts"
export { type Command, type Parsed, parse } from "./shell.ts"
export { place, quote, signature } from "./signature.ts"
