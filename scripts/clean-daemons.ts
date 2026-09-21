#!/usr/bin/env bun
/**
 * Kills cockpit daemons that nothing will ever talk to again.
 *
 *   bun run clean:daemons          # orphans and test daemons
 *   bun run clean:daemons --all    # those, and the one serving your own session
 *   bun run clean:daemons --list   # say what it would do, and do nothing
 *
 * **Development only.** A daemon is meant to outlive the editor — that is what keeps your dev server
 * running — so nothing in the shipped product goes looking for other people's daemons to kill.
 *
 * `test` and `check` run it first, because the failure it prevents is not a failure: the suite hangs
 * with no output, immune to the per-test timeout, and every instinct says to go looking in the code
 * that changed. It is not the code that changed. It is a daemon from an interrupted run, still
 * holding a shell that the next suite's teardown waits on forever.
 *
 * It exists because the test suite leaves them behind. Each suite starts real daemons in throwaway
 * homes under `/tmp`, and a run that is interrupted never gets to stop them. The leftovers then hang
 * the *next* run, which leaks more of them: an hour disappears into bisecting a test suite that is
 * only being haunted. Run this first when a suite hangs rather than fails.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

/**
 * Which daemon belongs to which home, from the pid files rather than the environment.
 *
 * A daemon's home is not on its command line, and macOS will not hand over another process's
 * environment — but every daemon writes its pid into its own home on the way up, so the homes that
 * still exist can say which pids are still accounted for.
 */
function homesByPid(): Map<number, string> {
  const homes = [join(homedir(), ".cache", "opencode-cockpit")]
  try {
    for (const entry of readdirSync("/tmp")) if (entry.startsWith("ck-")) homes.push(join("/tmp", entry))
  } catch {
    // no /tmp to read is not a problem worth failing over
  }
  const owners = new Map<number, string>()
  for (const home of homes) {
    const pidFile = join(home, "cockpitd.pid")
    if (!existsSync(pidFile)) continue
    const pid = Number.parseInt(readFileSync(pidFile, "utf8").trim(), 10)
    if (Number.isFinite(pid)) owners.set(pid, home)
  }
  return owners
}

/** Daemon processes, by pid. Deliberately narrow: a `grep` for this script must not match itself. */
function daemonPids(): number[] {
  const ps = Bun.spawnSync(["ps", "-eo", "pid=,command="])
  const pids: number[] = []
  for (const line of Buffer.from(ps.stdout).toString("utf8").split("\n")) {
    const [head, ...rest] = line.trim().split(/\s+/)
    const command = rest.join(" ")
    /** The entry point as an argument to a runtime — not a shell that merely mentions the path. */
    if (!/^\S+\/(opencode|bun|node)\s+\S*daemon\/(src\/main\.ts|dist\/main\.js)\s*$/.test(command)) continue
    const pid = Number.parseInt(head ?? "", 10)
    if (Number.isFinite(pid) && pid !== process.pid) pids.push(pid)
  }
  return pids
}

const all = process.argv.includes("--all")
const listOnly = process.argv.includes("--list")
const owners = homesByPid()
const pids = daemonPids()

if (pids.length === 0) {
  console.log("no cockpit daemons running")
  process.exit(0)
}

let killed = 0
let spared = 0
for (const pid of pids) {
  const home = owners.get(pid)
  /** No home claims it, so its home is gone: nothing can reach it, and nothing ever will. */
  const why = home === undefined ? "orphan" : home.startsWith("/tmp/") ? "test" : "live"
  const spare = why === "live" && !all
  console.log(
    `${spare ? "kept   " : listOnly ? "would  " : "stopped"} ${String(pid).padStart(6)}  ${why.padEnd(6)}  ${home ?? "home is gone"}`,
  )
  if (spare) {
    spared++
    continue
  }
  if (listOnly) continue
  try {
    process.kill(pid, "SIGTERM")
    killed++
  } catch {
    // gone between listing and killing, which is the outcome we wanted anyway
  }
}

if (!listOnly && killed > 0) console.log(`\nstopped ${killed} daemon${killed === 1 ? "" : "s"}`)
if (spared > 0) console.log("your own daemon was left alone; pass --all to stop it too")
