/**
 * What OpenCode actually sends to the terminal, byte for byte.
 *
 *   bun run capture --find bold --find 40%
 *   bun run capture --sidebar --out /tmp/raw.bin
 *
 * Why this exists: every other tool here looks at the *text*. `preview` paints with its own ANSI,
 * and the smoke harness serialises the screen through @xterm/headless, which throws colour and
 * attributes away. Both are blind to the class of bug that has cost the most time — a line that
 * rendered entirely magenta, a bar that sat grey for a whole session, an emphasis attribute that
 * type-checked and emitted nothing at all. This drives a real OpenCode, keeps the raw PTY bytes,
 * and reports the escape codes actually written around the text you name.
 */

import { Buffer } from "node:buffer"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"

const ESC = String.fromCharCode(27)
const SGR = new RegExp(`${ESC}\\[([0-9;]*)m`, "g")

const root = join(import.meta.dir, "..")
const opencode = Bun.which("opencode")
if (!opencode) {
  console.error("opencode binary not found; install OpenCode to capture from it")
  process.exit(1)
}

const args = process.argv.slice(2)
const flag = (name: string) => {
  const at = args.indexOf(`--${name}`)
  return at === -1 ? undefined : args[at + 1]
}
const all = (name: string) =>
  args.flatMap((arg, i) => (arg === `--${name}` && args[i + 1] ? [args[i + 1] as string] : []))

const work = mkdtempSync("/tmp/ck-capture-")
const config = join(work, "config")
const project = join(work, "project")
const raw: Buffer[] = []

try {
  const plugin = flag("plugin") ?? join(root, "packages", "opencode")
  const tui: Record<string, unknown> = { $schema: "https://opencode.ai/tui.json", plugin: [plugin] }
  if (args.includes("--sidebar")) {
    // A sidebar statusline draws in the space the host's own Context block would take.
    tui.plugin_enabled = { "internal:sidebar-context": false }
  }
  await Bun.write(join(config, "opencode", "tui.json"), JSON.stringify(tui))
  await Bun.write(
    join(config, "opencode", "opencode.json"),
    JSON.stringify({ $schema: "https://opencode.ai/config.json", plugin: [plugin] }),
  )
  // The bay's own settings come from the caller's, so what is captured is what they actually run.
  const cockpit = flag("config") ?? join(process.env.HOME ?? "", ".config/opencode-cockpit/config.json")
  if (await Bun.file(cockpit).exists()) {
    await Bun.write(join(config, "opencode-cockpit", "config.json"), await Bun.file(cockpit).text())
  }
  await Bun.write(join(project, ".keep"), "")

  const proc = Bun.spawn([opencode], {
    cwd: project,
    env: { ...process.env, XDG_CONFIG_HOME: config, TERM: "xterm-256color" },
    terminal: {
      cols: Number(flag("cols") ?? 150),
      rows: Number(flag("rows") ?? 44),
      data: (_t: unknown, chunk: Uint8Array) => raw.push(Buffer.from(chunk)),
    },
  } as Parameters<typeof Bun.spawn>[1]) as ReturnType<typeof Bun.spawn> & {
    terminal: { write(data: string): void }
  }

  await Bun.sleep(Number(flag("startup") ?? 15_000))
  proc.terminal.write(flag("say") ?? "reply with just the word ok")
  await Bun.sleep(800)
  proc.terminal.write("\r")
  await Bun.sleep(Number(flag("wait") ?? 12_000))
  if (args.includes("--sidebar")) {
    // ctrl+x b, built from a char code so a formatter cannot eat the control byte
    proc.terminal.write(`${String.fromCharCode(24)}b`)
    await Bun.sleep(2500)
  }
  proc.kill("SIGKILL")

  const data = Buffer.concat(raw).toString("utf8")
  const out = flag("out")
  if (out) await Bun.write(out, data)
  console.log(`captured ${data.length} bytes${out ? ` -> ${out}` : ""}`)

  const words = all("find")
  if (words.length === 0) {
    console.log("pass --find <text> to report the escape codes written around it")
  }
  for (const word of words) {
    const at = data.indexOf(word)
    if (at === -1) {
      console.log(`  ${word.padEnd(14)} not in the output — it never drew, or it was truncated`)
      continue
    }
    SGR.lastIndex = 0
    const before = data.slice(Math.max(0, at - 120), at)
    const codes = [...before.matchAll(SGR)].map((m) => m[1])
    console.log(`  ${word.padEnd(14)} SGR before it: ${codes.slice(-4).join(" · ") || "(none)"}`)
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}
