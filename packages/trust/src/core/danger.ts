/**
 * Which commands cost more trust.
 *
 * Nothing here blocks anything. A dangerous command still earns trust like any other; it needs the
 * normal threshold *plus* `dangerExtra` approvals in a row (docs/roadmap/trust.md, "Decided"). So a
 * miss in this list is never a hole — the command still had to be approved `threshold` times — it is
 * only a command that became automatic sooner than it should have.
 *
 * It sees one command at a time: `git add -A && git push --force` arrives as two, and only the second
 * is dangerous. `cwd` is already part of the signature; this is about what the words do.
 */

import type { Command } from "./shell.ts"

export function dangerous(command: Command): boolean {
  const [program, ...args] = command.argv
  if (program === undefined) return false
  // TODO(you): decide what is dangerous. See the request in the conversation.
  void args
  return false
}
