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
import { FEATURES } from "../packages/opencode/src/features.ts"

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
  /** The plumbing, then every bay — from the bundle's own list, so a new one cannot be left out. */
  for (const dir of ["protocol", "daemon", "client", "opencode", ...FEATURES]) {
    run(["bun", "pm", "pack", "--destination", tarballs], join(root, "packages", dir))
  }
  const names = [...new Bun.Glob("*.tgz").scanSync(tarballs)]
  const file = (prefix: string) => `file:${join(tarballs, names.find((n) => n.startsWith(prefix)) as string)}`
  await Bun.write(
    join(install, "package.json"),
    JSON.stringify({
      name: "smoke",
      private: true,
      dependencies: {
        "@opencode-cockpit/shell": file("opencode-cockpit-shell-"),
        "@opencode-cockpit/status": file("opencode-cockpit-status-"),
        "@opencode-cockpit/review": file("opencode-cockpit-review-"),
      },
      overrides: {
        "@opencode-cockpit/protocol": file("opencode-cockpit-protocol-"),
        "@opencode-cockpit/daemon": file("opencode-cockpit-daemon-"),
        "@opencode-cockpit/client": file("opencode-cockpit-client-"),
      },
    }),
  )
  run(["npm", "install"], install)

  /** Review reads git, so the project is a checkout with exactly one change to show. */
  await Bun.write(join(project, "SMOKE-REVIEW.ts"), "export const answer = 41\n")
  for (const cmd of [
    ["git", "init", "-q", "-b", "main"],
    ["git", "config", "user.email", "smoke@example.com"],
    ["git", "config", "user.name", "Smoke"],
    ["git", "add", "-A"],
    ["git", "commit", "-qm", "smoke"],
  ]) {
    run(cmd, project)
  }
  await Bun.write(join(project, "SMOKE-REVIEW.ts"), "export const answer = 42\n")

  // The plugins must live under node_modules: that is what disables OpenCode's Solid transform.
  const bay = (name: string) => join(install, "node_modules", "@opencode-cockpit", name)
  for (const [name, schema, plugins] of [
    ["opencode.json", "https://opencode.ai/config.json", [bay("shell")]],
    ["tui.json", "https://opencode.ai/tui.json", [bay("shell"), bay("status"), bay("review")]],
  ] as const) {
    await Bun.write(join(config, "opencode", name), JSON.stringify({ $schema: schema, plugin: plugins }))
  }
  /**
   * A statusline whose value has to come from somewhere the plugin cannot fake: a literal marker
   * proves the line drew at all, and a command segment proves the whole pipeline -- spawn, parse,
   * repaint -- works from a published build.
   */
  await Bun.write(
    join(project, ".cockpit.json"),
    JSON.stringify({
      statusline: {
        surface: "bottom",
        segments: [
          { type: "text", value: "STATUSLINE-DREW" },
          { type: "command", name: "smoke" },
        ],
        commands: { smoke: { run: "printf 'COMMAND-RAN'", intervalMs: 250 } },
      },
    }),
  )

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

  /**
   * The console, which was never opened here — so a crash on open was never caught here either.
   * Pressing `?` walks both halves of the key row: the keys that act, and the rest in the panel.
   */
  await type("\x18i", 3000) // ctrl+x i
  const consoleScreen = await screen()
  await type("?", 1500)
  const consoleDetails = await screen()
  await type("\x1b", 800) // esc, back to the conversation

  for (const [what, marker] of [
    ["the console never drew its keys", "[?]"],
    ["the console's action keys never drew", "[r]"],
  ] as const) {
    if (!consoleScreen.includes(marker)) throw new Error(`${what}:\n${consoleScreen}`)
  }
  if (!consoleDetails.includes("keys")) {
    throw new Error(`the details panel never listed the other keys:\n${consoleDetails}`)
  }

  /**
   * The review panel, from the same published build.
   *
   * It reads the repository rather than the session, so the project is a real checkout with one
   * uncommitted change — and the file is named for this test, so a panel that draws *something*
   * cannot pass for a panel that drew the diff.
   */
  await type("\x18v", 3000)
  const review = await screen()
  proc.kill("SIGKILL")

  /**
   * The statusline half. It shares this run rather than having its own, because what is being
   * proved is the same thing for both bays: that published, pre-compiled JSX actually renders
   * inside OpenCode. A statusline that never drew would otherwise reach users exactly the way the
   * frozen shell panel did in 0.1.3.
   */
  for (const [what, marker] of [
    ["the statusline never drew", "STATUSLINE-DREW"],
    ["the statusline's command segment never ran", "COMMAND-RAN"],
  ] as const) {
    if (!second.includes(marker)) throw new Error(`${what}:\n${second}`)
  }

  for (const [what, marker] of [
    ["the review panel never drew", "review"],
    ["the review panel drew no diff", "SMOKE-REVIEW"],
  ] as const) {
    if (!review.includes(marker)) throw new Error(`${what}:\n${review}`)
  }

  const ticks = (text: string) => [...text.matchAll(/tick (\d+)/g)].map((m) => Number(m[1]))
  const firstMax = Math.max(0, ...ticks(first))
  const secondMax = Math.max(0, ...ticks(second))
  if (firstMax === 0) throw new Error(`the panel never showed the shell's output:\n${first}`)
  if (secondMax <= firstMax) {
    throw new Error(
      `the panel froze: still at tick ${firstMax} after 4s (published JSX not Solid-compiled?)\n${second}`,
    )
  }
  console.log(
    `tui smoke passed: panel live, tick ${firstMax} → ${secondMax}; console and its keys drew; statusline drew; review drew its diff`,
  )
} finally {
  rmSync(work, { recursive: true, force: true })
}
