/**
 * OpenCode 2 finds a plugin configured by *path* by the files at its root — `<package>/tui`,
 * `<package>/server` — rather than through `exports` (docs/opencode/v2.md). A package installed by
 * name resolves through `exports` as before; this file is only the door for the path case.
 */
export { default } from "./dist/server.js"
