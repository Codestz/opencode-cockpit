/**
 * Records a real OpenCode session, driven by a script, into an asciicast v2 file.
 *
 *   bun scripts/record.ts tapes/dock.ts                  # → tapes/dock.cast
 *   agg tapes/dock.cast media/dock.gif                  # → GIF for READMEs
 *
 * Why not VHS or a screen recorder: the demos have to stay true as the UI changes, so they are
 * generated from the same PTY driver the TUI smoke test uses — real OpenCode, real plugin, real
 * output. A tape is a small module that lists the keystrokes; nothing about the session is faked.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

export interface Step {
  /** Keys to send, exactly as the terminal would receive them (see KEYS). */
  send?: string
  /** Wait this long afterwards, in milliseconds; the pause is part of the recording. */
  wait?: number
}

export interface Tape {
  /** Output basename, e.g. "dock" → tapes/dock.cast, media/dock.gif */
  name: string
  /** One line shown by players that support a title. */
  title: string
  cols?: number
  rows?: number
  /** Files to write into the throwaway project before OpenCode starts. */
  files?: Record<string, string>
  /** Settings for the plugin under test, written as the project's .cockpit.json. */
  config?: unknown
  /** Seconds to wait for OpenCode to start and load plugins before recording begins. */
  startupMs?: number
  steps: Step[]
}

/** Control sequences, so tapes read as intent rather than as escape codes. */
export const KEYS = {
  enter: "\r",
  esc: "\x1b",
  tab: "\t",
  ctrlP: "\x10",
  ctrlC: "\x03",
  up: "\x1b[A",
  down: "\x1b[B",
  slash: "/",
} as const

const root = resolve(import.meta.dir, "..")

async function record(tape: Tape): Promise<string> {
  const opencode = Bun.which("opencode")
  if (!opencode) throw new Error("opencode binary not found; install OpenCode to record")

  const cols = tape.cols ?? 120
  const rows = tape.rows ?? 34
  const work = join("/tmp", `ck-rec-${tape.name}`)
  rmSync(work, { recursive: true, force: true })
  const project = join(work, "project")
  const config = join(work, "config", "opencode")
  mkdirSync(project, { recursive: true })
  mkdirSync(config, { recursive: true })

  const plugin = join(root, "packages", "opencode")
  writeFileSync(join(config, "opencode.json"), JSON.stringify({ plugin: [plugin] }))
  writeFileSync(join(config, "tui.json"), JSON.stringify({ plugin: [plugin] }))
  if (tape.config) writeFileSync(join(project, ".cockpit.json"), JSON.stringify(tape.config, null, 2))
  for (const [name, content] of Object.entries(tape.files ?? {})) {
    const file = join(project, name)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, content, { mode: name.endsWith(".sh") ? 0o755 : 0o644 })
  }

  // asciicast v2: a header line, then [seconds, "o", output] events. Written as the session runs.
  const events: string[] = []
  let started = 0
  let recording = false

  const proc = Bun.spawn([opencode], {
    cwd: project,
    env: {
      ...process.env,
      XDG_CONFIG_HOME: join(work, "config"),
      COCKPIT_HOME: join(work, "home"),
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
    },
    terminal: {
      cols,
      rows,
      data(_t: unknown, chunk: Uint8Array) {
        if (!recording) return
        const at = ((Date.now() - started) / 1000).toFixed(3)
        events.push(`[${at}, "o", ${JSON.stringify(Buffer.from(chunk).toString("utf8"))}]`)
      },
    },
  } as Parameters<typeof Bun.spawn>[1]) as ReturnType<typeof Bun.spawn> & {
    terminal: { write(data: string): void }
  }

  await Bun.sleep(tape.startupMs ?? 14_000) // start-up and plugin load are not part of the demo
  started = Date.now()
  recording = true
  // A resize makes the TUI repaint everything, so the recording opens on a complete screen.
  proc.terminal.write("\x1b[8;;t")
  await Bun.sleep(400)

  for (const step of tape.steps) {
    if (step.send) proc.terminal.write(step.send)
    await Bun.sleep(step.wait ?? 600)
  }

  recording = false
  proc.kill("SIGKILL")

  const header = JSON.stringify({
    version: 2,
    width: cols,
    height: rows,
    title: tape.title,
    env: { TERM: "xterm-256color" },
  })
  const out = join(root, "tapes", `${tape.name}.cast`)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, `${header}\n${events.join("\n")}\n`)
  rmSync(work, { recursive: true, force: true })
  return out
}

const tapePath = process.argv[2]
if (!tapePath) {
  console.error("usage: bun scripts/record.ts <tape.ts>")
  process.exit(1)
}
const tape = ((await import(resolve(tapePath))) as { default: Tape }).default
const file = await record(tape)
const gif = join(root, "media", `${tape.name}.gif`)
console.log(`recorded ${file}\nrender with: agg --font-size 20 --theme asciinema ${file} ${gif}`)
