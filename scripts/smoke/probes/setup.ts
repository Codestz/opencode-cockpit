/**
 * Setting Cockpit up with the agent. Every interface entry offers the palette entry; only an agent side
 * ships `/cockpit-setup` and the `cockpit_settings` tool — so an install of Trust or the updater alone
 * has the entry and no slash name.
 */

import { join } from "node:path"
import { offered, popup, shipped } from "../commands.ts"
import {
  agent,
  expect,
  keep,
  kill,
  launch,
  pass,
  rightHalf,
  run,
  screen,
  seen,
  type,
  until,
  v2,
} from "../harness.ts"
import type { Install } from "../install.ts"
import type { Probe } from "../probe.ts"
import { TOKENS_ROW } from "./status.ts"

/** The line `/cockpit-setup` sends: once it is in the conversation, the command ran. */
const SETUP_LINE = "Use the cockpit-setup skill to help me set up Cockpit."
/** The skill loaded, and its first step taken — the tool it reads the live state with. Either version. */
const SETUP_SKILL_USED = [/Skill "cockpit-setup"/, /[⚙›] cockpit_settings/]
/** A prompt sent while the agent answers, waiting its turn: OpenCode 1's tag, OpenCode 2's line. */
const QUEUED = /QUEUED|1 queued · Use the cockpit-setup skill/

export const setup: Probe = {
  name: "setup",
  listed: "Ask the agent to set up Cockpit",
  async slash(install) {
    const listed = await popup("/cockpit-se")
    keep(listed)
    /** Once: the shipped command's row, and no second one from the interface. None with no agent side. */
    const rows = offered(listed, "/cockpit-setup")
    const want = install.agentSide ? 1 : 0
    expect(rows === want, `the slash popup offered /cockpit-setup ${rows} times, not ${want}`, listed)
    pass(
      install.agentSide
        ? "/cockpit-setup offered once as it was typed"
        : "/cockpit-setup not offered, with no agent side to ship it",
    )
  },
  ask: { call: "cockpit_settings", tool: "cockpit_settings" },
}

/**
 * AGENT=1: a second OpenCode, in a project nothing has happened in. `/cockpit-setup` from home has
 * to open a conversation, and the agent there has to load the `cockpit-setup` skill and call
 * `cockpit_settings` — the skill's first step. Run again while the agent answers, it has to queue
 * behind the reply rather than cut it off. With the conversation open the sidebar draws: the screen
 * returned is for each bay's `empty` to read — every block that lists something has to say it is
 * there while it is empty.
 */
export async function presence(install: Install): Promise<string> {
  const fresh = join(install.work, "fresh")
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
  launch(install.env, fresh, v2 ? ["--auto"] : [])
  await Bun.sleep(14_000)
  await shipped("cockpit-setup")
  const opened = await until(20_000, (text) => text.includes(SETUP_LINE))
  /** Again, while the agent is still answering the first. */
  await type("\x15", 300)
  await shipped("cockpit-setup")
  const queued = await until(8000, (text) => QUEUED.test(text))
  const used = await seen(180_000, SETUP_SKILL_USED)
  /** Status's table fills its tokens row once the reply is in: what says the sidebar has drawn. */
  const tokens = install.bays.includes("status")
    ? await until(60_000, (text) => TOKENS_ROW.test(rightHalf(text)))
    : await screen()
  await Bun.sleep(3000)
  const settled = await screen()
  kill()
  const drawn = TOKENS_ROW.test(rightHalf(settled)) ? settled : tokens
  keep(drawn)
  if (process.env.SMOKE_SHOW) console.log(drawn)
  expect(
    opened.includes(SETUP_LINE),
    "/cockpit-setup from home never opened a conversation with its line",
    opened,
  )
  expect(
    used.all,
    `/cockpit-setup's agent never used the skill (missing ${used.missing.join(", ")})`,
    used.last,
  )
  expect(QUEUED.test(queued), "/cockpit-setup while the agent answered never queued", queued)
  pass(
    "/cockpit-setup from home opened a conversation whose agent loaded the cockpit-setup skill and called cockpit_settings, and queued behind the reply",
  )
  return drawn
}

/** Whether `presence` can run: it needs a model, and the agent side that ships `/cockpit-setup`. */
export const canPresence = (install: Install) => agent && install.agentSide
