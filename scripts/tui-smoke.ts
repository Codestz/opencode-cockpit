/**
 * Drives a real OpenCode against the packed packages installed into `node_modules`, and asserts
 * the Shell panel keeps updating — and that every bay's commands are found and run from `ctrl+p`.
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
    "Call the tool shell_start with command 'echo AGENT-SHELL-OK' and description 'agent probe', then call review_list, then call subagents_list, then call cockpit_settings.",
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
  /** Bounded, and stdin closed: an open stdin or a permission prompt makes `opencode run` wait forever. */
  const result = Bun.spawnSync([...args, "--format", "json", prompt], {
    cwd: project,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 300_000,
  })
  if (result.exitCode === null || result.signalCode)
    throw new Error(`the agent turn never finished (5 min):\n${result.stdout.toString().slice(-3000)}`)
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
  for (const name of ["shell_start", "review_list", "subagents_list", "cockpit_settings"]) {
    if (!called.includes(name)) throw new Error(`the agent never completed ${name}:\n${report}`)
  }
  for (const heading of ["## Background shells", "## Review comments", "## Subagents"]) {
    if (!said.includes(heading)) throw new Error(`the agent was never told "${heading}":\n${report}`)
  }
}

const cols = Number(process.env.SMOKE_COLS) || 150
const rows = 40
/** One per OpenCode started: the second run (AGENT=1) draws on a clean screen of its own. */
let term = new Terminal({ cols, rows, allowProposedApi: true })
const screen = async () => {
  await new Promise<void>((done) => term.write("", done))
  const buffer = term.buffer.active
  return Array.from(
    { length: rows },
    (_, y) => buffer.getLine(buffer.baseY + y)?.translateToString(true) ?? "",
  ).join("\n")
}
/** The sidebar's half of a screen. */
const rightHalf = (text: string) =>
  text
    .split("\n")
    .map((line) => line.slice(Math.floor(cols / 2)))
    .join("\n")
/**
 * Which of `patterns` showed on some screen within `ms` — not all on one: a turn scrolls the first
 * out of view before the last arrives. Done as soon as every one has.
 */
const seen = async (ms: number, patterns: readonly RegExp[]) => {
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
const until = async (ms: number, done: (text: string) => boolean) => {
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
const under = (text: string, heading: string): string | undefined => {
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
/**
 * A subagent's row in the sidebar: its status glyph, then the agent's name — shortened to `explo…`
 * or `exp…` when the title wants the room.
 */
const EXPLORE_ROW = /[●○⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] exp(lore|l?o?…) /
/** The Status table's token row, which only a conversation with a reply in it fills. */
const TOKENS_ROW = / tokens [\d.]+k? · \d+%/
/** The line `/cockpit-setup` sends: once it is in the conversation, the command ran. */
const SETUP_LINE = "Use the cockpit-setup skill to help me set up Cockpit."
/** The skill loaded, and its first step taken — the tool it reads the live state with. Either version. */
const SETUP_SKILL_USED = [/Skill "cockpit-setup"/, /[⚙›] cockpit_settings/]
/** `/statusline`'s line, which says the new name first, and the skill it names, loaded. */
const STATUS_SKILL_USED = [
  /\/statusline is now \/status-setup\. Use the status-setup skill/,
  /Skill "status-setup"/,
]
/** A prompt sent while the agent answers, waiting its turn: OpenCode 1's tag, OpenCode 2's line. */
const QUEUED = /QUEUED|1 queued · Use the cockpit-setup skill/

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
        "@opencode-cockpit/trust": file("opencode-cockpit-trust-"),
        "@opencode-cockpit/trail": file("opencode-cockpit-trail-"),
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
  const tuiBays = [
    bay("shell"),
    bay("status"),
    bay("review"),
    bay("updater"),
    bay("subagents"),
    bay("trail"),
    bay("trust"),
  ]
  /** Status's agent side carries only the `status-setup` skill and its commands. */
  const serverBays = [bay("shell"), bay("status"), bay("review"), bay("subagents"), bay("trail")]
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
        /**
         * The setup skills read and write Cockpit's config, outside the project: a prompt it would
         * wait on forever here. OpenCode 2 is started with `--auto` for the same reason.
         */
        ...(process.env.AGENT && !v2 && name === "opencode.json"
          ? { permission: { external_directory: "allow" } }
          : {}),
      }),
    )
  }
  /**
   * A statusline whose value has to come from somewhere the plugin cannot fake: a literal marker
   * proves the line drew at all, and a command segment proves the whole pipeline -- spawn, parse,
   * repaint -- works from a published build.
   *
   * The global file carries the section's name from before 0.9, `statusline`: it is no longer read,
   * and Status has to say so in a `!` row instead of drawing as if nothing had been written.
   */
  await Bun.write(
    join(config, "opencode-cockpit", "config.json"),
    JSON.stringify({ statusline: { preset: "minimal" } }),
  )
  await Bun.write(
    join(project, ".cockpit.json"),
    JSON.stringify({
      status: {
        surface: "bottom",
        segments: [
          { type: "text", value: "STATUSLINE-DREW" },
          { type: "command", name: "smoke" },
        ],
        commands: { smoke: { run: "printf 'COMMAND-RAN'", intervalMs: 250 } },
      },
      /** An old name in Review's section: the pane has to say so in a `!` row. */
      review: { sidebarOrder: 3 },
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
  const launch = (cwd: string, args: string[] = []) => {
    const screenOf = new Terminal({ cols, rows, allowProposedApi: true })
    term = screenOf
    return Bun.spawn([opencode, ...(v2 ? ["--standalone"] : []), ...args], {
      cwd,
      env,
      terminal: {
        cols,
        rows,
        data: (_t: unknown, chunk: Uint8Array) => screenOf.write(chunk.slice()),
      },
    } as Parameters<typeof Bun.spawn>[1]) as ReturnType<typeof Bun.spawn> & {
      terminal: { write(data: string): void }
    }
  }
  let proc = launch(project)
  const type = async (keys: string, waitMs: number) => {
    proc.terminal.write(keys)
    await Bun.sleep(waitMs)
  }

  await Bun.sleep(14_000) // OpenCode start-up, plugin install and load
  await type("\x10", 1000) // ctrl+p command palette
  await type("Start a background shell", 1200)
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
   * The palette (`ctrl+p`), where a command can be listed and still do nothing you can see — Trust's
   * "show or hide in the sidebar" did exactly that. Every bay's commands must be found by typing
   * "cockpit" and the bay, and one command per bay (palette-only where the bay has one) must show
   * its effect. The capture's selection is not to be trusted blindly (docs/building/testing.md), so
   * the screen is read before `enter`: the entry has to be at the top, right under the query.
   */
  const atTop = (listed: string, query: string, title: string) => {
    const lines = listed.split("\n")
    const field = lines.findIndex((line) => line.trim() === query)
    return (
      field >= 0 &&
      lines
        .slice(field + 1)
        .filter((line) => line.trim())
        .slice(0, 2)
        .some((line) => line.includes(title))
    )
  }
  const palette = async (title: string, waitMs = 2500) => {
    await type("\x10", 1000) // ctrl+p
    await type(title, 1500)
    const listed = await screen()
    if (!atTop(listed, title, title))
      throw new Error(`the palette did not offer "${title}" first:\n${listed}`)
    await type("\r", waitMs)
    return await screen()
  }
  const found: [string, string][] = []
  for (const [name, title] of [
    ["shell", "Start a background shell"],
    ["status", "Ask the agent to set up the status bay"],
    ["review", "Open or close the changes"],
    ["updater", "Update plugins"],
    ["subagents", "Open the subagents"],
    ["trail", "Show what this conversation made"],
    ["trust", "Show what Trust answers for you"],
    ["setup", "Ask the agent to set up Cockpit"],
  ] as const) {
    await type("\x10", 1000)
    await type(`cockpit ${name}`, 1500)
    const listed = await screen()
    if (!listed.includes(title)) found.push([`"cockpit ${name}" never listed "${title}"`, listed])
    await type("\x1b", 800)
  }
  /** Each surface is closed before the next: an open review takes the keys, `ctrl+p` included. */
  const ranReview = await palette("Toggle the changes full screen", 3000)
  await type("\x1b", 1200)
  const ran = {
    /** Palette-only: closed, it used to change nothing on screen; now it opens, full screen. */
    review: ranReview,
    subagents: await palette("Clear finished subagents", 1200),
    trust: await palette("Show or hide Trust in the sidebar", 1200),
    ledger: await palette("Show what Trust answers for you", 2500),
  }
  await type("\x1b", 1200)
  const ranUpdater = await palette("Update plugins", 4000)
  await type("\x1b", 1200)
  /** From home there is no conversation, so Trail opens on the project's records: none, and says so. */
  const ranTrail = await palette("Show what this conversation made", 2500)
  await type("\x1b", 1200)

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
    for (let i = 0; i < 45 && !EXPLORE_ROW.test(sidebar); i++) {
      await Bun.sleep(2000)
      sidebar = await screen()
    }
    await Bun.sleep(4000)
    /** Found again before every click: the blocks above it (the statusline's) grow as the turn runs. */
    const clickSubagent = async () => {
      const lines = (await screen()).split("\n")
      const right = Math.floor(cols / 2)
      const y = lines.findIndex((line) => EXPLORE_ROW.test(line.slice(right)))
      if (y < 0) throw new Error(`the sidebar never showed the subagent:\n${lines.join("\n")}`)
      const x = right + ((lines[y] as string).slice(right).search(EXPLORE_ROW) as number) + 3
      proc.terminal.write(`\x1b[<0;${x + 1};${y + 1}M`)
      await Bun.sleep(80)
      await type(`\x1b[<0;${x + 1};${y + 1}m`, 2500)
    }
    await clickSubagent()
    const full = await screen()
    /** `?` swaps the run for every key the pane takes, and `?` again brings the run back. */
    await type("?", 1200)
    const keys = await screen()
    await type("?", 1000)
    /**
     * The cursor onto the last item and open it, then a message typed into the pane, not a dialog.
     * Each key waits on what it needs on screen rather than a fixed time: the run's first item can
     * take a while to arrive on a slow turn, and `enter` with no cursor yet opens nothing.
     */
    await until(30_000, (text) => /[›⌄◇◆] /.test(rightHalf(text)))
    await type("k", 300)
    await until(5000, (text) => text.includes("▌ "))
    await type("\r", 1200)
    const toggled = await screen()
    await type("m", 600)
    await type("hello there", 1200)
    const typing = await screen()
    await type("\x1b", 800)
    await type("q", 1500)
    const slashed = await slash("subagents")
    /**
     * A message to the finished subagent: it answers, and the exchange is added to the main
     * conversation without starting a turn there (v1 draws it as a message, v2 as one line).
     */
    await clickSubagent()
    /** The relay is for a finished subagent: one still at work (or held on a permission) answers its run. */
    const finished = (await screen()).includes("done in")
    await type("m", 600)
    /** Half typed, half pasted — a paste is one event, not keys, and used to land in OpenCode's prompt. */
    await type("Reply with just the word ", 600)
    await type("\x1b[200~RELAY-OK.\x1b[201~", 1000)
    const pasted = await screen()
    await type("\r", 2000)
    let relayed = await screen()
    for (let i = 0; i < 40 && !relayed.includes("The main agent now knows"); i++) {
      await Bun.sleep(2000)
      relayed = await screen()
    }
    await type("q", 1500)
    /** Whatever an earlier step left in the prompt goes, or its menu covers the conversation. */
    await type("\x15", 300)
    await type("\x1b", 1500)
    const conversation = await screen()
    /** `x` on a finished subagent takes it off the list; on a working one it asks first. */
    await clickSubagent()
    await type("x", 1500)
    const removed = await screen()
    await type("q", 1000)
    return { sidebar, full, keys, toggled, typing, slashed, finished, pasted, relayed, conversation, removed }
  }

  /** `ready`: read as soon as it shows, for what does not stay — a toast the next one replaces. */
  const slash = async (name: string, ready?: (text: string) => boolean) => {
    await type(`/${name}`, 300)
    /** `enter` once the popup offers the name: with the agent busy it can take longer to list. */
    await until(4000, (text) => new RegExp(`/${name}\\s{2,}\\S`).test(text))
    await type("\r", ready ? 0 : 4000)
    const drawn = ready ? await until(4000, ready) : await screen()
    await type("\x1b", 1000)
    return drawn
  }
  /**
   * A command the agent side ships, which OpenCode runs as its own: on OpenCode 1 `enter` on the popup
   * first completes the name into the prompt, and a second `enter` sends it (measured, both versions).
   */
  const shipped = async (name: string) => {
    await type(`/${name}`, 300)
    await until(4000, (text) => new RegExp(`/${name}\\s{2,}\\S`).test(text))
    await type("\r", 1200)
    if (new RegExp(`┃\\s+/${name}\\s*$`, "m").test(await screen())) await type("\r", 0)
  }
  const updater = await slash("plugins-update")
  const subagents = process.env.AGENT ? await subagentsInTheInterface() : undefined
  /**
   * The setup commands' slash names, shipped by the agent side, offered in the popup as they are typed
   * — once each: the interface's palette entries for them carry no slash name. Only listed here, not
   * run: running one asks a model, and a run without AGENT=1 stays offline.
   */
  const popup = async (typed: string) => {
    await type("\x15", 300)
    await type(typed, 1500)
    const listed = await screen()
    await type("\x15", 300)
    await type("\x1b", 800)
    return listed
  }
  const popups = {
    "/cockpit-setup": await popup("/cockpit-se"),
    "/status-setup": await popup("/status-se"),
  }
  /**
   * AGENT=1: Status's command under its old name, kept for a release as a command of its own whose
   * line says the new name first, and the skill it names loaded. In the conversation the subagent run
   * left open, last, because it starts a turn. `/status-setup` sends the same line without the note.
   */
  const status = process.env.AGENT
    ? await (async () => {
        /** Whatever an earlier step left in the prompt goes first, or the name is typed after it. */
        await type("\x15", 300)
        await shipped("statusline")
        const old = await seen(120_000, STATUS_SKILL_USED)
        /** The skill asks a question next; `esc` dismisses it so nothing is left waiting. */
        await type("\x1b", 1000)
        return { old }
      })()
    : undefined
  proc.kill("SIGKILL")

  /**
   * AGENT=1: a second OpenCode, in a project nothing has happened in. `/cockpit-setup` from home has
   * to open a conversation, and the agent there has to load the `cockpit-setup` skill and call
   * `cockpit_settings` — the skill's first step. Run again while the agent answers, it has to queue
   * behind the reply rather than cut it off. With the conversation open the sidebar draws: every
   * block that lists something has to say it is there while it is empty — the heading and `none yet`
   * — and the Status table, which nothing configures here, has to be the default surface, with the
   * global file's old `statusline` named in a `!` row in the sidebar.
   */
  const presence = async () => {
    const fresh = join(work, "fresh")
    await Bun.write(join(fresh, "README.md"), "fresh\n")
    for (const cmd of [
      ["git", "init", "-q", "-b", "main"],
      ["git", "config", "user.email", "smoke@example.com"],
      ["git", "config", "user.name", "Smoke"],
      ["git", "add", "-A"],
      ["git", "commit", "-qm", "fresh"],
    ]) {
      run(cmd, fresh)
    }
    /** The skill has the agent read Cockpit's config, outside the project: nothing may wait on a prompt. */
    proc = launch(fresh, v2 ? ["--auto"] : [])
    await Bun.sleep(14_000)
    await shipped("cockpit-setup")
    const opened = await until(20_000, (text) => text.includes(SETUP_LINE))
    /** Again, while the agent is still answering the first. */
    await type("\x15", 300)
    await shipped("cockpit-setup")
    const queued = await until(8000, (text) => QUEUED.test(text))
    const used = await seen(180_000, SETUP_SKILL_USED)
    const drawn = await until(60_000, (text) => TOKENS_ROW.test(rightHalf(text)))
    await Bun.sleep(3000)
    const settled = await screen()
    proc.kill("SIGKILL")
    return { opened, used, queued, drawn: TOKENS_ROW.test(rightHalf(settled)) ? settled : drawn }
  }
  const fresh = process.env.AGENT ? await presence() : undefined
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
  if (!second.includes(`! settings: "statusline" is no longer read`))
    throw new Error(`Status never named the old "statusline" section:\n${second}`)
  for (const [name, listed] of Object.entries(popups)) {
    /** Once: the shipped command's row, and no second one from the interface. */
    /** A row: at the popup's edge, the name, a gap on the same line, its description. */
    const rows = listed.match(new RegExp(`┃ ${name} {2,}\\S`, "g")) ?? []
    if (rows.length !== 1)
      throw new Error(`the slash popup offered ${name} ${rows.length} times, not once:\n${listed}`)
  }
  if (status && !status.old.all)
    throw new Error(
      `/statusline never ran the status-setup skill with its new name said (missing ${status.old.missing.join(", ")}):\n${status.old.last}`,
    )

  for (const marker of ["Nothing recorded in this project yet.", "[esc] Close"]) {
    if (!ranTrail.includes(marker))
      throw new Error(`the palette's Trail never drew "${marker}":\n${ranTrail}`)
  }

  for (const [what, marker] of [
    ["the review panel never drew", "review"],
    ["the review panel drew no diff", "SMOKE-REVIEW"],
    ["the review panel never named its old setting", '! settings: "review.sidebarOrder"'],
  ] as const) {
    if (!review.includes(marker)) throw new Error(`${what}:\n${review}`)
  }

  const missing = found[0]
  if (missing) throw new Error(`${missing[0]}:\n${missing[1]}`)
  for (const [what, text, marker] of [
    ["the palette's full-screen toggle never opened the changes", ran.review, "SMOKE-REVIEW"],
    ["the palette's clear never answered", ran.subagents, "No finished subagents to clear."],
    ["the palette's Trust sidebar toggle said nothing", ran.trust, "Shown in the sidebar."],
    /** /trust opens on what Trust did; the ledger is one key further, behind `l`. */
    ["the palette never opened Trust's activity screen", ran.ledger, "Open the ledger"],
  ] as const) {
    if (!text.includes(marker)) throw new Error(`${what}:\n${text}`)
  }
  /** Full screen puts the header on the top row; the pane leaves it to the conversation. */
  if (!ran.review.split("\n")[0]?.includes("review"))
    throw new Error(`the palette's toggle opened the changes, but not full screen:\n${ran.review}`)

  for (const [what, text] of [
    ["/plugins-update", updater],
    ["the palette's Update plugins", ranUpdater],
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
      ["the full screen never offered every key", subagents.full, "[?] Keys"],
      ["? never showed every key", subagents.keys, "KEYS"],
      ["the keys screen never said how back", subagents.keys, "[esc] Hide Keys"],
      ["enter never opened the selected item", subagents.toggled, "▌ "],
      ["m never opened the message input in the pane", subagents.typing, "┃ hello there"],
      ["/subagents never opened the full screen", subagents.slashed, "[m] Message"],
    ] as const) {
      if (!text.includes(marker)) throw new Error(`${what}:\n${text}`)
    }
    /** The heading's count reaches the sidebar's edge whole: rows drawn wider than it were clipped. */
    if (!/Subagents +\d+ (running|done|failed)\b/.test(subagents.sidebar))
      throw new Error(`the sidebar's Subagents heading was clipped:\n${subagents.sidebar}`)
    if (!subagents.pasted.includes("┃ Reply with just the word RELAY-OK."))
      throw new Error(`a paste never reached the message field:\n${subagents.pasted}`)
    if (subagents.finished) {
      if (!subagents.relayed.includes("The main agent now knows"))
        throw new Error(`the subagent's answer was never relayed to the main agent:\n${subagents.relayed}`)
      if (!/Cockpit notification|Subagent exchange/.test(subagents.conversation))
        throw new Error(`the main conversation never showed the relayed exchange:\n${subagents.conversation}`)
    } else console.log("relay not checked: the subagent had not finished when the message was sent")
    const asked = subagents.removed.includes("Press x again")
    const listed = EXPLORE_ROW.test(subagents.removed)
    if (!asked && listed)
      throw new Error(`x neither removed the subagent nor asked to stop it:\n${subagents.removed}`)
  }

  /** A plugin OpenCode could not load says so in the footer, whichever half it was. */
  for (const text of [
    first,
    second,
    consoleScreen,
    fullScreen,
    review,
    updater,
    ranTrail,
    ...Object.values(ran),
    ...Object.values(popups),
    ...(fresh ? [fresh.drawn] : []),
  ]) {
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
  if (fresh) {
    const { opened, used, queued, drawn } = fresh
    if (process.env.SMOKE_SHOW) console.log(drawn)
    if (!opened.includes(SETUP_LINE))
      throw new Error(`/cockpit-setup from home never opened a conversation with its line:\n${opened}`)
    if (!used.all)
      throw new Error(
        `/cockpit-setup's agent never used the skill (missing ${used.missing.join(", ")}):\n${used.last}`,
      )
    if (!QUEUED.test(queued))
      throw new Error(`/cockpit-setup while the agent answered never queued:\n${queued}`)
    for (const heading of ["Subagents", "Shells", "Trail"]) {
      if (!under(drawn, heading)?.startsWith("none yet"))
        throw new Error(`the sidebar never drew "${heading}" with "none yet" under it:\n${drawn}`)
    }
    if (!TOKENS_ROW.test(rightHalf(drawn)))
      throw new Error(`the sidebar never drew the Status table's tokens row:\n${drawn}`)
    if (!rightHalf(drawn).includes(`! settings: "statusline" is no longer`))
      throw new Error(`the sidebar never named the old "statusline" section:\n${drawn}`)
  }
  if (process.env.AGENT) agentTurn(env)
  /**
   * AGENT=1: Trail's measurement against the installed server half — a turn that opens a PR (with a
   * fake `gh`) must end with the agent having recorded it, without being told to.
   */
  if (process.env.AGENT) {
    const measured = Bun.spawnSync(
      ["bun", join(root, "packages/trail/measure/agent.ts"), "--plugin", bay("trail"), "--runs", "1"],
      {
        cwd: root,
        env: { ...process.env, OPENCODE: opencode },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        /** Three attempts of five minutes each, inside the measurement. */
        timeout: 1_000_000,
      },
    )
    if (measured.exitCode !== 0)
      throw new Error(`Trail's measurement failed:\n${measured.stdout}\n${measured.stderr}`.slice(-3000))
  }
  console.log(
    `tui smoke passed: panel live, tick ${firstMax} → ${secondMax}; console and its keys drew; full screen drew; statusline drew and named its old section; review drew its diff and named its old setting; updater answered its slash name; trail opened empty; every bay and /cockpit-setup found under "cockpit" in the palette, and the commands ran from there; /cockpit-setup and /status-setup offered once each as they were typed${subagents ? "; a subagent showed in the sidebar and opened full screen, by click and by /subagents, with its keys; /statusline ran the status-setup skill, saying its new name" : ""}${fresh ? "; /cockpit-setup from home opened a conversation whose agent loaded the cockpit-setup skill and called cockpit_settings, and queued behind the reply; an empty sidebar said none yet in every block, under the Status table" : ""}${process.env.AGENT ? "; an agent called the bays' tools and was told about them; Trail's measurement recorded the PR" : ""}`,
  )
} finally {
  /** KEEP=1 leaves the install and project behind, to inspect what a run actually loaded. */
  if (process.env.KEEP) console.log(`kept ${work}`)
  else rmSync(work, { recursive: true, force: true })
}
