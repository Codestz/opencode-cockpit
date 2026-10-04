/**
 * What every probe drives OpenCode with: the binary and its version, a headless xterm per OpenCode
 * started, the keys typed into it, and the ways a screen is read back.
 */

import { mkdirSync, rmSync, statSync } from "node:fs"
import { join } from "node:path"
import { Terminal } from "@xterm/headless"

export const root = join(import.meta.dir, "..", "..")
/** OPENCODE picks the binary, so the same test can drive v1 and v2 side by side. */
const binary = process.env.OPENCODE ?? Bun.which("opencode")
if (!binary) {
  console.error("opencode binary not found; install OpenCode to run this smoke test")
  process.exit(1)
}
export const opencode: string = binary

/** Which OpenCode this is decides where plugins are configured and how it is started. */
export const v2 = Bun.spawnSync([opencode, "--version"])
  .stdout.toString()
  .trim()
  .replace(/^opencode\s+v?/, "")
  .startsWith("2")

/** `AGENT=1`: the runs that need the network and a model willing to follow instructions. */
export const agent = Boolean(process.env.AGENT)

export const run = (cmd: string[], cwd: string) => {
  const result = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0) throw new Error(`$ ${cmd.join(" ")}\n${result.stdout}\n${result.stderr}`)
  return result.stdout.toString()
}

/**
 * Build and pack under a lock. `build` empties every `dist/` before it compiles, so a second run
 * (v1 and v2 side by side, or a `dev:install`) packing at that moment shipped a bay without its
 * files: OpenCode said "1 plugin failed" and Trust's commands were missing. A directory is the lock
 * (`mkdir` is atomic); one older than ten minutes is left over from a killed run.
 */
const buildLock = join(root, "node_modules", ".cockpit-build.lock")
export async function withBuildLock(work: () => void): Promise<void> {
  for (;;) {
    try {
      mkdirSync(buildLock)
      break
    } catch {
      const age = Date.now() - (statSync(buildLock, { throwIfNoEntry: false })?.mtimeMs ?? Date.now())
      if (age > 600_000) rmSync(buildLock, { recursive: true, force: true })
      else await Bun.sleep(500)
    }
  }
  try {
    work()
  } finally {
    rmSync(buildLock, { recursive: true, force: true })
  }
}

export const cols = Number(process.env.SMOKE_COLS) || 150
const rows = 40
/** One per OpenCode started: the second run (AGENT=1) draws on a clean screen of its own. */
let term = new Terminal({ cols, rows, allowProposedApi: true })
type Pty = ReturnType<typeof Bun.spawn> & { terminal: { write(data: string): void } }
let proc: Pty | undefined

export const screen = async () => {
  await new Promise<void>((done) => term.write("", done))
  const buffer = term.buffer.active
  return Array.from(
    { length: rows },
    (_, y) => buffer.getLine(buffer.baseY + y)?.translateToString(true) ?? "",
  ).join("\n")
}

/** v2 would attach to the user's background service; a private server keeps the run to itself. */
export const launch = (env: Record<string, string | undefined>, cwd: string, args: string[] = []) => {
  const screenOf = new Terminal({ cols, rows, allowProposedApi: true })
  term = screenOf
  proc = Bun.spawn([opencode, ...(v2 ? ["--standalone"] : []), ...args], {
    cwd,
    env,
    terminal: {
      cols,
      rows,
      data: (_t: unknown, chunk: Uint8Array) => screenOf.write(chunk.slice()),
    },
  } as Parameters<typeof Bun.spawn>[1]) as Pty
}
export const kill = () => proc?.kill("SIGKILL")

export const type = async (keys: string, waitMs: number) => {
  proc?.terminal.write(keys)
  await Bun.sleep(waitMs)
}

/** The sidebar's half of a screen. */
export const rightHalf = (text: string) =>
  text
    .split("\n")
    .map((line) => line.slice(Math.floor(cols / 2)))
    .join("\n")
/**
 * Which of `patterns` showed on some screen within `ms` — not all on one: a turn scrolls the first
 * out of view before the last arrives. Done as soon as every one has.
 */
export const seen = async (ms: number, patterns: readonly RegExp[]) => {
  const found = new Set<number>()
  for (const end = Date.now() + ms; found.size < patterns.length && Date.now() < end; await Bun.sleep(250)) {
    const text = await screen()
    for (const [at, pattern] of patterns.entries()) if (pattern.test(text)) found.add(at)
  }
  return {
    all: found.size === patterns.length,
    missing: patterns.filter((_, at) => !found.has(at)),
    last: await screen(),
  }
}
/** Reads the screen until `done` says so, or `ms` runs out; the last screen either way. */
export const until = async (ms: number, done: (text: string) => boolean) => {
  let text = await screen()
  for (const end = Date.now() + ms; !done(text) && Date.now() < end; text = await screen()) {
    await Bun.sleep(250)
  }
  return text
}
/**
 * A block's heading in the sidebar, and the first row under it (past the heading's air) — read in
 * the heading's own column, so the conversation beside it cannot answer for the block.
 */
export const under = (text: string, heading: string): string | undefined => {
  const lines = text.split("\n")
  const right = Math.floor(cols / 2)
  for (const [y, line] of lines.entries()) {
    const at = line.slice(right).search(new RegExp(`(^|\\s)${heading}(\\s|$)`))
    if (at < 0) continue
    const x = right + at + (line[right + at] === " " ? 1 : 0)
    const next = lines.slice(y + 1, y + 4).find((row) => row.slice(x).trim())
    return next?.slice(x).trim()
  }
  return undefined
}

/** Fails with what was on screen. */
export function expect(ok: unknown, what: string, text: string): void {
  if (!ok) throw new Error(`${what}:\n${text}`)
}

/**
 * Every screen a probe kept, for the one check that holds on all of them: a plugin OpenCode could
 * not load says so in the footer, whichever half it was.
 */
const kept: string[] = []
export const keep = (...texts: string[]) => {
  kept.push(...texts)
}
export function noPluginFailed(): void {
  for (const text of kept) expect(!/plugins? failed/.test(text), "OpenCode could not load a plugin", text)
}

/** What each probe proved, in the order it proved it: the run's last line. */
export const passed: string[] = []
export const pass = (note: string) => {
  passed.push(note)
}
