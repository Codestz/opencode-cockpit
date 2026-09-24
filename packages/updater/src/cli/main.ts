/**
 * The CLI against the real machine: the terminal, the filesystem, the registry, `opencode`.
 *
 * A function rather than a script so two bins can share it — this package's own, and the bundle's
 * `opencode-cockpit update`, which is the name people already have. Node APIs only: under `npx`
 * there may be no `bun` on PATH, and a bin that cannot start is the one failure this command exists
 * to get people out of.
 */

import { spawnSync } from "node:child_process"
import { accessSync, constants, existsSync, mkdirSync, rmSync } from "node:fs"
import { homedir } from "node:os"
import { createInterface } from "node:readline/promises"
import { nodeDisk } from "../core/disk.ts"
import { fetchAllLatest, registryFrom } from "../core/registry.ts"
import { runOpencode } from "../core/spawn.ts"
import { doctor } from "../doctor/run.ts"
import { update } from "./run.ts"

function worktree(cwd: string): string | undefined {
  const git = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" })
  return git.status === 0 ? git.stdout.trim() || undefined : undefined
}

export function main(argv: readonly string[]): Promise<number> {
  const tty = Boolean(process.stdout.isTTY)
  if (argv[0] === "doctor") {
    const cwd = process.cwd()
    const tree = worktree(cwd)
    return doctor(argv, {
      env: process.env,
      home: homedir(),
      cwd,
      ...(tree ? { worktree: tree } : {}),
      disk: nodeDisk,
      exists: (path) => existsSync(path),
      run(command, args) {
        const result = spawnSync(command, args, { encoding: "utf8", timeout: 10_000 })
        return result.error ? undefined : { status: result.status ?? 1, stdout: result.stdout ?? "" }
      },
      alive(pid) {
        try {
          process.kill(pid, 0)
          return true
        } catch {
          return false
        }
      },
      writable(dir) {
        try {
          mkdirSync(dir, { recursive: true })
          accessSync(dir, constants.W_OK)
          return true
        } catch {
          return false
        }
      },
      fetchLatest: (names) => fetchAllLatest(names, { registry: registryFrom(process.env) }),
      now: Date.now(),
      write: (text) => process.stdout.write(text),
      color: tty && !process.env.NO_COLOR,
    })
  }
  return update(argv, {
    env: process.env,
    home: homedir(),
    cwd: process.cwd(),
    disk: nodeDisk,
    worktree,
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
