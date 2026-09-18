import type { ShellInfo } from "@opencode-cockpit/protocol/shell"
import { commandOf } from "./find.ts"

/** What a shell is, derived from its command — never a label anyone has to maintain by hand. */
export type ShellKind = "server" | "tests" | "watcher" | "build" | "task"

const TESTS = /\b(test|tests|vitest|jest|mocha|pytest|rspec|phpunit|playwright|cypress|karma)\b/i
const SERVER =
  /\b(dev|serve|server|start|preview|nodemon|uvicorn|gunicorn|rails s|php -S|docker[\s-]compose\s+up|ngrok|tunnel)\b/i
const WATCHER = /(--watch|\bwatch\b|watchexec|fswatch|chokidar|\btsc\s+-w\b|--hot|\bentr\b)/i
const BUILD =
  /\b(build|assemble|compile|bundle|tsc|webpack|rollup|esbuild|tsup|make|gradlew?|mvn|cargo build)\b/i

/**
 * Order matters: a test runner in watch mode is still about tests, and `vite build` is a build even
 * though `vite` usually serves.
 */
export function classify(command: string): ShellKind {
  if (TESTS.test(command)) return "tests"
  if (BUILD.test(command) && !SERVER.test(command)) return "build"
  if (SERVER.test(command)) return "server"
  if (WATCHER.test(command)) return "watcher"
  return "task"
}

export function kindOfShell(s: ShellInfo): ShellKind {
  return classify(commandOf(s))
}
