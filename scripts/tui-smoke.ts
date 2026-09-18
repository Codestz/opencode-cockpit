/**
 * Drives a real OpenCode against the packed packages installed into `node_modules`, and asserts
 * the Shell panel keeps updating.
 *
 *   bun scripts/tui-smoke.ts
 *
 * Why it exists: OpenCode only Solid-compiles plugin JSX outside `node_modules`, so a published
 * plugin can load, log, and talk to the daemon while rendering exactly one frozen frame (0.1.3 and
 * 0.1.4 shipped that way). Only a real OpenCode can prove the rendering path; unit tests and the
 * pack check cannot. Needs the `opencode` binary, so it stays out of CI.
 */

import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { Terminal } from "@xterm/headless"

const root = join(import.meta.dir, "..")
const opencode = Bun.which("opencode")
if (!opencode) {
  console.error("opencode binary not found; install OpenCode to run this smoke test")
  process.exit(1)
}

const work = mkdtempSync("/tmp/ck-smoke-")
const install = join(work, "install")
const project = join(work, "project")
const config = join(work, "config")
const home = join(work, "home")

const run = (cmd: string[], cwd: string) => {
  const result = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0) throw new Error(`$ ${cmd.join(" ")}\n${result.stdout}\n${result.stderr}`)
  return result.stdout.toString()
}

const cols = 150
const rows = 40
const term = new Terminal({ cols, rows, allowProposedApi: true })
const screen = async () => {
  await new Promise<void>((done) => term.write("", done))
  const buffer = term.buffer.active
  return Array.from(
    { length: rows },
    (_, y) => buffer.getLine(buffer.baseY + y)?.translateToString(true) ?? "",
  ).join("\n")
}

try {
  run(["bun", "run", "build"], root)
  const tarballs = join(work, "tarballs")
  for (const dir of ["protocol", "daemon", "client", "shell", "opencode"]) {
    run(["bun", "pm", "pack", "--destination", tarballs], join(root, "packages", dir))
  }
  const names = [...new Bun.Glob("*.tgz").scanSync(tarballs)]
  const file = (prefix: string) => `file:${join(tarballs, names.find((n) => n.startsWith(prefix)) as string)}`
  await Bun.write(
    join(install, "package.json"),
    JSON.stringify({
      name: "smoke",
      private: true,
      dependencies: { "@opencode-cockpit/shell": file("opencode-cockpit-shell-") },
      overrides: {
        "@opencode-cockpit/protocol": file("opencode-cockpit-protocol-"),
        "@opencode-cockpit/daemon": file("opencode-cockpit-daemon-"),
        "@opencode-cockpit/client": file("opencode-cockpit-client-"),
      },
    }),
  )
  run(["npm", "install"], install)

  // The plugin must live under node_modules: that is what disables OpenCode's Solid transform.
  const plugin = join(install, "node_modules", "@opencode-cockpit", "shell")
  for (const [name, schema] of [
    ["opencode.json", "https://opencode.ai/config.json"],
    ["tui.json", "https://opencode.ai/tui.json"],
  ]) {
    await Bun.write(
      join(config, "opencode", name as string),
      JSON.stringify({ $schema: schema, plugin: [plugin] }),
    )
  }
  await Bun.write(join(project, ".keep"), "")

  const proc = Bun.spawn([opencode], {
    cwd: project,
    env: { ...process.env, XDG_CONFIG_HOME: config, COCKPIT_HOME: home, TERM: "xterm-256color" },
    terminal: {
      cols,
      rows,
      data: (_t: unknown, chunk: Uint8Array) => term.write(chunk.slice()),
    },
  } as Parameters<typeof Bun.spawn>[1]) as ReturnType<typeof Bun.spawn> & {
    terminal: { write(data: string): void }
  }
  const type = async (keys: string, waitMs: number) => {
    proc.terminal.write(keys)
    await Bun.sleep(waitMs)
  }

  await Bun.sleep(14_000) // OpenCode start-up, plugin install and load
  await type("\x10", 1000) // ctrl+p command palette
  await type("New background shell", 1200)
  await type("\r", 1200)
  await type("i=0; while true; do i=$((i+1)); echo tick $i; sleep 1; done", 300)
  await type("\r", 3500)

  const first = await screen()
  await Bun.sleep(4000)
  const second = await screen()
  proc.kill("SIGKILL")

  const ticks = (text: string) => [...text.matchAll(/tick (\d+)/g)].map((m) => Number(m[1]))
  const firstMax = Math.max(0, ...ticks(first))
  const secondMax = Math.max(0, ...ticks(second))
  if (firstMax === 0) throw new Error(`the panel never showed the shell's output:\n${first}`)
  if (secondMax <= firstMax) {
    throw new Error(
      `the panel froze: still at tick ${firstMax} after 4s (published JSX not Solid-compiled?)\n${second}`,
    )
  }
  console.log(`tui smoke passed: panel live, tick ${firstMax} → ${secondMax}`)
} finally {
  rmSync(work, { recursive: true, force: true })
}
