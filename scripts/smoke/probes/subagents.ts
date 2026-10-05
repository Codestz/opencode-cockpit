/**
 * Subagents: its clear answers from the palette; with AGENT=1, a real subagent shows in the sidebar
 * and its full screen opens, takes messages and relays the answer.
 */

import { palette, slash } from "../commands.ts"
import { agent, cols, expect, keep, pass, rightHalf, screen, type, under, until } from "../harness.ts"
import type { Probe } from "../probe.ts"

/**
 * A subagent's row in the sidebar: its status glyph, then the agent's name in the block's agent column,
 * eight cells at most, so `explore` whole (the old `expl…`/`exp…` still read, for an older build).
 */
const EXPLORE_ROW = /[●○⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] exp(lore|l?o?…) /

/** Found again before every click: the blocks above it (the statusline's) grow as the turn runs. */
const clickSubagent = async () => {
  const lines = (await screen()).split("\n")
  const right = Math.floor(cols / 2)
  const y = lines.findIndex((line) => EXPLORE_ROW.test(line.slice(right)))
  if (y < 0) throw new Error(`the sidebar never showed the subagent:\n${lines.join("\n")}`)
  const x = right + ((lines[y] as string).slice(right).search(EXPLORE_ROW) as number) + 3
  await type(`\x1b[<0;${x + 1};${y + 1}M`, 80)
  await type(`\x1b[<0;${x + 1};${y + 1}m`, 2500)
}

/**
 * AGENT=1: a real subagent, launched from the interface. The sidebar has to show it while it works,
 * a click on it has to open the full screen with its run, and `/subagents` has to open that screen
 * rather than OpenCode's own `/agents`, whose name it contains.
 */
const inTheInterface = async () => {
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

  for (const [what, text, marker] of [
    ["the sidebar never showed the Subagents block", sidebar, "Subagents"],
    ["a click on the subagent never opened its full screen", full, "EXPLORE"],
    ["the full screen never drew its keys", full, "[m] Message"],
    ["the full screen never offered every key", full, "[?] Keys"],
    ["? never showed every key", keys, "KEYS"],
    ["the keys screen never said how back", keys, "[esc] Hide Keys"],
    ["enter never opened the selected item", toggled, "▌ "],
    ["m never opened the message input in the pane", typing, "┃ hello there"],
    ["/subagents never opened the full screen", slashed, "[m] Message"],
  ] as const) {
    expect(text.includes(marker), what, text)
  }
  /** The heading's count reaches the sidebar's edge whole: rows drawn wider than it were clipped. */
  expect(
    /Subagents +\d+ (running|done|failed)\b/.test(sidebar),
    "the sidebar's Subagents heading was clipped",
    sidebar,
  )
  expect(
    pasted.includes("┃ Reply with just the word RELAY-OK."),
    "a paste never reached the message field",
    pasted,
  )
  if (finished) {
    expect(
      relayed.includes("The main agent now knows"),
      "the subagent's answer was never relayed to the main agent",
      relayed,
    )
    expect(
      /Cockpit notification|Subagent exchange/.test(conversation),
      "the main conversation never showed the relayed exchange",
      conversation,
    )
  } else console.log("relay not checked: the subagent had not finished when the message was sent")
  const asked = removed.includes("Press x again")
  const listed = EXPLORE_ROW.test(removed)
  expect(asked || !listed, "x neither removed the subagent nor asked to stop it", removed)
  pass("a subagent showed in the sidebar and opened full screen, by click and by /subagents, with its keys")
}

export const subagents: Probe = {
  name: "subagents",
  listed: "Open the subagents",
  async palette() {
    const ran = await palette("Clear finished subagents", 1200)
    keep(ran)
    expect(ran.includes("No finished subagents to clear."), "the palette's clear never answered", ran)
  },
  async slash() {
    if (agent) await inTheInterface()
  },
  empty(drawn) {
    expect(
      under(drawn, "Subagents")?.startsWith("none yet"),
      `the sidebar never drew "Subagents" with "none yet" under it`,
      drawn,
    )
  },
  ask: { call: "subagents_list", tool: "subagents_list", heading: "## Subagents" },
}
