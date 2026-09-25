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
/** OPENCODE picks the binary, so the same test can drive v1 and v2 side by side. */
const opencode = process.env.OPENCODE ?? Bun.which("opencode")
if (!opencode) {
  console.error("opencode binary not found; install OpenCode to run this smoke test")
  process.exit(1)
}

/** Which OpenCode this is decides where plugins are configured and how it is started. */
const v2 = Bun.spawnSync([opencode, "--version"])
  .stdout.toString()
  .trim()
  .replace(/^opencode\s+v?/, "")
  .startsWith("2")
console.log(`smoke against OpenCode ${v2 ? "2" : "1"} (${opencode})`)

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

/**
 * `AGENT=1`: one real turn, by a free OpenCode Zen model, against the server halves — the only proof
 * that the tools registered and the system prompt carries the guidance, on either version. Needs the
 * network and a model willing to follow instructions, so it is opt-in.
 */
function agentTurn(env: Record<string, string | undefined>) {
  const prompt = [
    "Call the tool shell_start with command 'echo AGENT-SHELL-OK' and description 'agent probe', then call review_list.",
    "Your system prompt has heading lines starting with '## Background shells', '## Review comments' and '## Subagents'.",
    "Quote all three heading lines exactly in your reply.",
  ].join(" ")
  const args = [
    opencode as string,
    "run",
    ...(v2 ? ["--standalone", "--auto"] : []),
    "-m",
    "opencode/space-bunny-free",
  ]
  const result = Bun.spawnSync([...args, "--format", "json", prompt], {
    cwd: project,
    env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const events = result.stdout
    .toString()
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as { type: string; part?: Record<string, never> })
  /** v2 runs plugin tools through Code Mode: the calls are listed on its `execute` part. */
  const called = events
    .filter((event) => event.type === "tool_use")
    .flatMap((event) => {
      const part = event.part as unknown as {
        tool: string
        state: {
          status: string
          metadata?: { metadata?: { toolCalls?: { tool: string; status: string }[] } }
        }
      }
      return [
        { tool: part.tool, status: part.state.status },
        ...(part.state.metadata?.metadata?.toolCalls ?? []),
      ]
    })
    .filter((call) => call.status === "completed")
    .map((call) => call.tool)
  const said = events
    .filter((event) => event.type === "text")
    .map((event) => (event.part as unknown as { text: string }).text)
    .join("\n")
  const report = `${result.stdout}\n${result.stderr}`.slice(-3000)
  for (const name of ["shell_start", "review_list"]) {
    if (!called.includes(name)) throw new Error(`the agent never completed ${name}:\n${report}`)
  }
  for (const heading of ["## Background shells", "## Review comments", "## Subagents"]) {
    if (!said.includes(heading)) throw new Error(`the agent was never told "${heading}":\n${report}`)
  }
}

const cols = Number(process.env.SMOKE_COLS) || 150
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
        "@opencode-cockpit/updater": file("opencode-cockpit-updater-"),
        "@opencode-cockpit/subagents": file("opencode-cockpit-subagents-"),
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
  const tuiBays = [bay("shell"), bay("status"), bay("review"), bay("updater"), bay("subagents")]
  const serverBays = [bay("shell"), bay("review"), bay("subagents")]
  /**
   * v1 reads `plugin` from opencode.json and tui.json; v2 reads `plugins` from opencode.json and
   * cli.json (docs/opencode/v2.md). The same packages go in either way.
   */
  const files: [string, string, string, string[]][] = v2
    ? [
        ["opencode.json", "https://opencode.ai/config.json", "plugins", serverBays],
        ["cli.json", "https://opencode.ai/cli.json", "plugins", tuiBays],
      ]
    : [
        ["opencode.json", "https://opencode.ai/config.json", "plugin", serverBays],
        ["tui.json", "https://opencode.ai/tui.json", "plugin", tuiBays],
      ]
  for (const [name, schema, key, plugins] of files) {
    /** v1's schema URLs mean nothing to v2, whose loader skipped files carrying them. */
    await Bun.write(
      join(config, "opencode", name),
      JSON.stringify({
        ...(v2 ? {} : { $schema: schema }),
        [key]: plugins,
        /** A model that needs no key, for the turns AGENT=1 runs inside the interface. */
        ...(process.env.AGENT && name === "opencode.json" ? { model: "opencode/space-bunny-free" } : {}),
      }),
    )
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

  const env = {
    ...process.env,
    XDG_CONFIG_HOME: config,
    /** OpenCode's kv lives here: without its own, a run writes plugin state into the user's real one. */
    XDG_STATE_HOME: join(work, "state"),
    COCKPIT_HOME: home,
    TERM: "xterm-256color",
  }
  /** v2 would attach to the user's background service; a private server keeps the run to itself. */
  const proc = Bun.spawn(v2 ? [opencode, "--standalone"] : [opencode], {
    cwd: project,
    env,
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

  /**
   * Full screen, which neither version's run opened before — so on OpenCode 2 it could draw nothing
   * and still pass. `w` swaps the dialog for it and is remembered, so it is swapped back before leaving.
   */
  await type("\x18i", 3000)
  await type("w", 2500)
  const fullScreen = await screen()
  await type("w", 1500)
  await type("\x1b", 800)
  if (process.env.SMOKE_SHOW) console.log(fullScreen)
  /** The dialog sits inside the host's frame; only full screen puts the header on the top row. */
  if (!fullScreen.split("\n")[0]?.includes("RUN") || !/^ {2}│ tick \d+/m.test(fullScreen)) {
    throw new Error(`full screen never drew the console across the window:\n${fullScreen}`)
  }

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
  await type("\x18v", 1500) // close the review again

  /**
   * The updater's dialog, opened by its slash name and by the old one it replaced — two slash names
   * for one surface is exactly what docs/opencode/keys-and-commands.md warns can break the popup.
   * Every plugin here is a local path, so the list must say so, and nothing may be written.
   */
  /**
   * AGENT=1: a real subagent, launched from the interface. The sidebar has to show it while it works,
   * a click on it has to open the full screen with its run, and `/subagents` has to open that screen
   * rather than OpenCode's own `/agents`, whose name it contains.
   */
  const subagentsInTheInterface = async () => {
    await type(
      "Use the task/subagent tool to launch an explore subagent with the task: read SMOKE-REVIEW.ts and report its export. Wait for it, then reply DONE.",
      400,
    )
    await type("\r", 1000)
    let sidebar = ""
    for (let i = 0; i < 45 && !/[●○⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] explore /.test(sidebar); i++) {
      await Bun.sleep(2000)
      sidebar = await screen()
    }
    await Bun.sleep(4000)
    const lines = (await screen()).split("\n")
    const y = lines.findIndex((line) => /[●○⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] explore /.test(line.slice(Math.floor(cols / 2))))
    if (y < 0) throw new Error(`the sidebar never showed the subagent:\n${lines.join("\n")}`)
    const x = (lines[y] as string).lastIndexOf(" explore ") + 3
    proc.terminal.write(`\x1b[<0;${x + 1};${y + 1}M`)
    await Bun.sleep(80)
    await type(`\x1b[<0;${x + 1};${y + 1}m`, 2500)
    const full = await screen()
    /** The cursor onto the last item and open it, then a message typed into the pane, not a dialog. */
    await type("k", 600)
    await type("\r", 1200)
    const toggled = await screen()
    await type("m", 600)
    await type("hello there", 1200)
    const typing = await screen()
    await type("\x1b", 800)
    await type("q", 1500)
    const slashed = await slash("subagents")
    /** `x` on a finished subagent takes it off the list; on a working one it asks first. */
    proc.terminal.write(`\x1b[<0;${x + 1};${y + 1}M`)
    await Bun.sleep(80)
    await type(`\x1b[<0;${x + 1};${y + 1}m`, 2500)
    await type("x", 1500)
    const removed = await screen()
    await type("q", 1000)
    return { sidebar, full, toggled, typing, slashed, removed }
  }

  const slash = async (name: string) => {
    await type(`/${name}`, 1200)
    await type("\r", 4000)
    const drawn = await screen()
    await type("\x1b", 1000)
    return drawn
  }
  const updater = await slash("plugins-update")
  const legacy = await slash("cockpit-update")
  const subagents = process.env.AGENT ? await subagentsInTheInterface() : undefined
  proc.kill("SIGKILL")
  // `SMOKE_SHOW=1 bun run smoke:tui` prints the updater's frame: a marker proves it drew, not how.
  if (process.env.SMOKE_SHOW) console.log(updater)

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

  for (const [what, text] of [
    ["/plugins-update", updater],
    ["/cockpit-update", legacy],
  ] as const) {
    /** OpenCode 2 updates plugins itself; there the commands point at it instead of opening the dialog. */
    for (const marker of v2 ? ["change the version"] : ["Plugins", "published", "local", "Review"]) {
      if (!text.includes(marker)) throw new Error(`${what} did not draw "${marker}":\n${text}`)
    }
  }

  if (subagents) {
    for (const [what, text, marker] of [
      ["the sidebar never showed the Subagents block", subagents.sidebar, "Subagents"],
      ["a click on the subagent never opened its full screen", subagents.full, "EXPLORE"],
      ["the full screen never drew its keys", subagents.full, "[m] Message"],
      ["enter never opened the selected item", subagents.toggled, "▌ "],
      ["m never opened the message input in the pane", subagents.typing, "┃ hello there"],
      ["/subagents never opened the full screen", subagents.slashed, "[m] Message"],
    ] as const) {
      if (!text.includes(marker)) throw new Error(`${what}:\n${text}`)
    }
    /** The heading's count reaches the sidebar's edge whole: rows drawn wider than it were clipped. */
    if (!/Subagents +\d+ (running|done|failed)\b/.test(subagents.full))
      throw new Error(`the sidebar's Subagents heading was clipped:\n${subagents.full}`)
    const asked = subagents.removed.includes("Press x again")
    const listed = /[●○⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] explore /.test(subagents.removed)
    if (!asked && listed)
      throw new Error(`x neither removed the subagent nor asked to stop it:\n${subagents.removed}`)
  }

  /** A plugin OpenCode could not load says so in the footer, whichever half it was. */
  for (const text of [first, second, consoleScreen, fullScreen, review, updater]) {
    if (/plugins? failed/.test(text)) throw new Error(`OpenCode could not load a plugin:\n${text}`)
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
  if (process.env.AGENT) agentTurn(env)
  console.log(
    `tui smoke passed: panel live, tick ${firstMax} → ${secondMax}; console and its keys drew; full screen drew; statusline drew; review drew its diff; updater answered both slash names${subagents ? "; a subagent showed in the sidebar and opened full screen, by click and by /subagents" : ""}${process.env.AGENT ? "; an agent called both bays' tools and was told about them" : ""}`,
  )
} finally {
  /** KEEP=1 leaves the install and project behind, to inspect what a run actually loaded. */
  if (process.env.KEEP) console.log(`kept ${work}`)
  else rmSync(work, { recursive: true, force: true })
}
