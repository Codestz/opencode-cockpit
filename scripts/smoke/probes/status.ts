/**
 * Status: the statusline draws from a published build and names a section from before 0.9; its setup
 * command is offered once; and its sidebar table flags an MCP server that failed, and only that one.
 */

import { join } from "node:path"
import { offered, popup, shipped } from "../commands.ts"
import { agent, expect, keep, kill, launch, pass, rightHalf, screen, seen, type, until } from "../harness.ts"
import type { Probe } from "../probe.ts"

/** The Status table's token row, which only a conversation with a reply in it fills. */
export const TOKENS_ROW = / tokens [\d.]+k? · \d+%/
/** `/statusline`'s line, which says the new name first, and the skill it names, loaded. */
const STATUS_SKILL_USED = [
  /\/statusline is now \/status-setup\. Use the status-setup skill/,
  /Skill "status-setup"/,
]
const OLD_SECTION = `! settings: "statusline" is no longer read`
/** A minimal stdio MCP server: answers initialize, lists one tool, runs it. Run with Bun. */
const OK_MCP = `import { createInterface } from "node:readline"
const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\\n")
createInterface({ input: process.stdin }).on("line", (line) => {
  let req
  try { req = JSON.parse(line) } catch { return }
  if (req.id === undefined) return
  if (req.method === "initialize")
    return send({ jsonrpc: "2.0", id: req.id, result: {
      protocolVersion: req.params?.protocolVersion ?? "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "ok-test", version: "1.0.0" },
    } })
  if (req.method === "tools/list")
    return send({ jsonrpc: "2.0", id: req.id, result: { tools: [{
      name: "ping", description: "Answers pong.", inputSchema: { type: "object", properties: {} },
    }] } })
  if (req.method === "tools/call")
    return send({ jsonrpc: "2.0", id: req.id, result: { content: [{ type: "text", text: "pong" }] } })
  send({ jsonrpc: "2.0", id: req.id, result: {} })
})
`

export const status: Probe = {
  name: "status",
  listed: "Ask the agent to set up the status bay",
  /**
   * The statusline half. It shares this run rather than having its own, because what is being
   * proved is the same thing for every bay: that published, pre-compiled JSX actually renders
   * inside OpenCode. A statusline that never drew would otherwise reach users exactly the way the
   * frozen shell panel did in 0.1.3.
   */
  async open() {
    const markers = ["STATUSLINE-DREW", "COMMAND-RAN", OLD_SECTION]
    const drawn = await until(15_000, (text) => markers.every((marker) => text.includes(marker)))
    keep(drawn)
    for (const [what, marker] of [
      ["the statusline never drew", "STATUSLINE-DREW"],
      ["the statusline's command segment never ran", "COMMAND-RAN"],
    ] as const) {
      expect(drawn.includes(marker), what, drawn)
    }
    expect(drawn.includes(OLD_SECTION), `Status never named the old "statusline" section`, drawn)
    pass("statusline drew and named its old section")
  },
  async slash() {
    const listed = await popup("/status-se")
    keep(listed)
    /** Once: the shipped command's row, and no second one from the interface. */
    const rows = offered(listed, "/status-setup")
    expect(rows === 1, `the slash popup offered /status-setup ${rows} times, not once`, listed)
    pass("/status-setup offered once as it was typed")
    if (!agent) return
    /**
     * AGENT=1: Status's command under its old name, kept for a release as a command of its own whose
     * line says the new name first, and the skill it names loaded. In the conversation the subagent run
     * left open, last, because it starts a turn. `/status-setup` sends the same line without the note.
     */
    /** Whatever an earlier step left in the prompt goes first, or the name is typed after it. */
    await type("\x15", 300)
    await shipped("statusline")
    const old = await seen(120_000, STATUS_SKILL_USED)
    /** The skill asks a question next; `esc` dismisses it so nothing is left waiting. */
    await type("\x1b", 1000)
    expect(
      old.all,
      `/statusline never ran the status-setup skill with its new name said (missing ${old.missing.join(", ")})`,
      old.last,
    )
    pass("/statusline ran the status-setup skill, saying its new name")
  },
  /**
   * Status's `diagnostics` row in the sidebar table, on both versions (#34: OpenCode 2 hands a
   * server's status as `{ status: "connected" }`, and every healthy server was flagged). A project
   * with two MCP servers: a small stdio server that answers, and one whose command does not exist.
   * The table — the default surface, nothing configures it here — draws in a conversation, so one
   * short turn is sent (a free model; the only turn outside AGENT=1). Then, with the servers given
   * time to connect or fail: no `! ok-test`, and `! broken-test` drawn, which proves the row was live.
   * One `opencode.json` for both: 2.0 reads `mcp.servers`, 1.18 the flat keys (2.0 ignored a .jsonc).
   */
  async apart(install) {
    const at = join(install.work, "mcp")
    const okMcp = join(install.work, "ok-mcp.ts")
    await Bun.write(okMcp, OK_MCP)
    const servers = {
      "ok-test": { type: "local", command: [process.execPath, okMcp] },
      "broken-test": { type: "local", command: ["cockpit-does-not-exist"] },
    }
    await Bun.write(
      join(at, "opencode.json"),
      JSON.stringify({ model: "opencode/space-bunny-free", mcp: { servers, ...servers } }),
    )
    await Bun.write(join(at, "README.md"), "mcp\n")
    launch(install.env, at)
    await Bun.sleep(14_000)
    await type("Reply with just the word hi.", 400)
    await type("\r", 1000)
    const drawn = await until(90_000, (text) => /! broken-test/.test(rightHalf(text)))
    /** A healthy server that is flagged at all may be flagged only once it has connected. */
    await Bun.sleep(8000)
    const settled = await screen()
    kill()
    keep(settled)
    if (process.env.SMOKE_SHOW) console.log(settled)
    expect(
      /! broken-test/.test(rightHalf(drawn)) && /! broken-test/.test(rightHalf(settled)),
      "the Status table never flagged the broken MCP server",
      settled,
    )
    for (const text of [drawn, settled]) {
      expect(!/!\s+ok-test/.test(text), "the Status table flagged a healthy MCP server", text)
    }
    pass("the Status table flagged the broken MCP server and not the healthy one")
  },
  /**
   * The Status table, which nothing configures in a fresh project, has to be the default surface,
   * with the global file's old `statusline` named in a `!` row in the sidebar.
   */
  empty(drawn) {
    expect(TOKENS_ROW.test(rightHalf(drawn)), "the sidebar never drew the Status table's tokens row", drawn)
    expect(
      rightHalf(drawn).includes(`! settings: "statusline" is no longer`),
      `the sidebar never named the old "statusline" section`,
      drawn,
    )
  },
}
