/**
 * What an approval is an approval *of*.
 *
 * A signature is the command exactly as it will run — environment, program, every argument in order,
 * and where it runs — with quoting normalised so that `echo 'a b'` and `echo "a b"` are one thing.
 * Nothing is generalised away. OpenCode's own "always" generalises, and measured on its own arity
 * table, `docker compose -p cockpit up -d` and `docker compose -p prod down -v` both became
 * `docker compose -p *` (docs/opencode/permissions.md). A signature can only ever match the command
 * that earned it; making one cover more is something a person does, in the ledger, on purpose.
 */

import { posix } from "node:path"
import type { Command } from "./shell.ts"

/** Words that need no quotes to read back as themselves. */
const PLAIN = /^[A-Za-z0-9_@%+=:,./~^-]+$/

export function quote(word: string): string {
  if (PLAIN.test(word)) return word
  return `'${word.replace(/'/g, `'\\''`)}'`
}

/**
 * Where a command runs, said relative to the project: `cd /path/to/project && git status` is
 * `git status`. A directory outside the project stays absolute, so it cannot pass for one inside.
 */
export function place(cwd: string | undefined, root: string | undefined): string | undefined {
  if (cwd === undefined) return undefined
  if (root === undefined || !posix.isAbsolute(cwd)) return posix.normalize(cwd)
  const relative = posix.relative(root, posix.normalize(cwd))
  if (relative === "") return undefined
  if (relative.startsWith("..") || posix.isAbsolute(relative)) return posix.normalize(cwd)
  return relative
}

export function signature(command: Command, root?: string): string {
  const where = place(command.cwd, root)
  /** A redirection is written bare and an argument quoted, so `echo > x` and `echo '>' x` differ. */
  const ops = new Set(command.redirects ?? [])
  const words = [
    ...command.env.map(quote),
    ...command.argv.map((word, i) => (ops.has(i) ? word : quote(word))),
  ].join(" ")
  return where === undefined ? words : `(in ${quote(where)}) ${words}`
}
