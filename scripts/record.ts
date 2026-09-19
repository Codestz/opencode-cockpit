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

import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { SerializeAddon } from "@xterm/addon-serialize"
import { Terminal } from "@xterm/headless"

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
  /** Plugin spec to load. Defaults to this checkout; an npm spec tests what users actually get. */
  plugin?: string
  /** Driven before recording starts: setup nobody needs to watch (starting the shells, say). */
  warmup?: Step[]
  steps: Step[]
}

/** Control sequences, so tapes read as intent rather than as escape codes. */
export const KEYS = {
  enter: "\r",
  esc: "\x1b",
  tab: "\t",
  ctrlP: "\x10",
  ctrlC: "\x03",
  /** OpenCode's leader is ctrl+x; cockpit binds <leader>o and <leader>i. */
  dock: "\x18o",
  console: "\x18i",
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
  const data = join(work, "data", "opencode")
  mkdirSync(project, { recursive: true })
  mkdirSync(config, { recursive: true })
  mkdirSync(data, { recursive: true })

  // A fresh data directory, so remembered interface state (an open panel, a selected shell) cannot
  // leak in from the machine doing the recording — but carry the credentials over, or the model
  // half of a session cannot run at all.
  const realAuth = join(process.env.HOME ?? "", ".local/share/opencode/auth.json")
  if (existsSync(realAuth)) copyFileSync(realAuth, join(data, "auth.json"))

  const plugin = tape.plugin ?? join(root, "packages", "opencode")
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

  // A cast holds only what changed after it started, and a TUI redraws deltas — so a recording that
  // begins mid-session opens on a half-drawn screen. Mirror the session in a headless terminal and
  // use its serialized state as frame zero.
  const mirror = new Terminal({ cols, rows, allowProposedApi: true })
  const serializer = new SerializeAddon()
  mirror.loadAddon(serializer)

  const proc = Bun.spawn([opencode], {
    cwd: project,
    env: {
      ...process.env,
      XDG_CONFIG_HOME: join(work, "config"),
      XDG_DATA_HOME: join(work, "data"),
      COCKPIT_HOME: join(work, "home"),
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
    },
    terminal: {
      cols,
      rows,
      data(_t: unknown, chunk: Uint8Array) {
        const text = Buffer.from(chunk).toString("utf8")
        mirror.write(text)
        if (!recording) return
        const at = ((Date.now() - started) / 1000).toFixed(3)
        events.push(`[${at}, "o", ${JSON.stringify(text)}]`)
      },
    },
  } as Parameters<typeof Bun.spawn>[1]) as ReturnType<typeof Bun.spawn> & {
    terminal: { write(data: string): void }
  }

  await Bun.sleep(tape.startupMs ?? 14_000) // start-up and plugin load are not part of the demo
  for (const step of tape.warmup ?? []) {
    if (step.send) proc.terminal.write(step.send)
    await Bun.sleep(step.wait ?? 600)
  }
  await new Promise<void>((done) => mirror.write("", done)) // let the mirror catch up
  const opening = `\x1b[2J\x1b[H${serializer.serialize()}`
  started = Date.now()
  recording = true
  events.push(`[0.000, "o", ${JSON.stringify(opening)}]`)
  await Bun.sleep(150)

  for (const step of tape.steps) {
    if (step.send) proc.terminal.write(step.send)
    await Bun.sleep(step.wait ?? 600)
  }

  recording = false
  proc.kill("SIGKILL")
  mirror.dispose()

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
