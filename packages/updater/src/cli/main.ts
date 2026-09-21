/**
 * The CLI against the real machine: the terminal, the filesystem, the registry, `opencode`.
 *
 * A function rather than a script so two bins can share it — this package's own, and the bundle's
 * `opencode-cockpit update`, which is the name people already have. Node APIs only: under `npx`
 * there may be no `bun` on PATH, and a bin that cannot start is the one failure this command exists
 * to get people out of.
 */

import { spawnSync } from "node:child_process"
import { rmSync } from "node:fs"
import { homedir } from "node:os"
import { createInterface } from "node:readline/promises"
import { nodeDisk } from "../core/disk.ts"
import { fetchAllLatest, registryFrom } from "../core/registry.ts"
import { runOpencode } from "../core/spawn.ts"
import { update } from "./run.ts"

export function main(argv: readonly string[]): Promise<number> {
  const tty = Boolean(process.stdout.isTTY)
  return update(argv, {
    env: process.env,
    home: homedir(),
    cwd: process.cwd(),
    disk: nodeDisk,
    worktree(cwd) {
      const git = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" })
      return git.status === 0 ? git.stdout.trim() || undefined : undefined
    },
    fetchLatest: (names) => fetchAllLatest(names, { registry: registryFrom(process.env) }),
    opencode: (args, cwd) => runOpencode("opencode", args, cwd),
    remove: (dir) => rmSync(dir, { recursive: true, force: true }),
    ...(process.stdin.isTTY
      ? {
          async ask(question: string) {
            const rl = createInterface({ input: process.stdin, output: process.stdout })
            const answer = await rl.question(question)
            rl.close()
            return !/^n/i.test(answer.trim())
          },
        }
      : {}),
    write: (text) => process.stdout.write(text),
    width: Math.max(60, Math.min(process.stdout.columns || 100, 120)),
    color: tty && !process.env.NO_COLOR,
  })
}
