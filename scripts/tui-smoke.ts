/**
 * Drives a real OpenCode against the packed packages installed into `node_modules`, and asserts
 * the Shell panel keeps updating — and that every bay's commands are found and run from `ctrl+p`.
 *
 *   bun scripts/tui-smoke.ts                          every bay as its own package, side by side
 *   SMOKE_INSTALL=bundle bun scripts/tui-smoke.ts     the `opencode-cockpit` bundle alone
 *   SMOKE_INSTALL=trust bun scripts/tui-smoke.ts      one bay alone (any of the bundle's FEATURES)
 *
 * `OPENCODE=<path>` picks the binary, `AGENT=1` adds the model turns, `KEEP=1` keeps the install,
 * `SMOKE_SHOW=1` prints the frames a marker cannot describe.
 *
 * Why it exists: OpenCode only Solid-compiles plugin JSX outside `node_modules`, so a published
 * plugin can load, log, and talk to the daemon while rendering exactly one frozen frame (0.1.3 and
 * 0.1.4 shipped that way). Only a real OpenCode can prove the rendering path; unit tests and the
 * pack check cannot. Needs the `opencode` binary, so it stays out of CI.
 *
 * The steps and what they assert live in one probe per bay (`smoke/probes/`); this file decides the
 * order they run in, a stage at a time, and runs a probe only when its bay is installed.
 */

import { rmSync } from "node:fs"
import { agentTurn } from "./smoke/agent.ts"
import { search, settle } from "./smoke/commands.ts"
import {
  agent,
  expect,
  keep,
  kill,
  launch,
  noPluginFailed,
  opencode,
  pass,
  passed,
  v2,
} from "./smoke/harness.ts"
import { prepare, readMode } from "./smoke/install.ts"
import type { Probe } from "./smoke/probe.ts"
import { review } from "./smoke/probes/review.ts"
import { canPresence, presence, setup } from "./smoke/probes/setup.ts"
import { shell } from "./smoke/probes/shell.ts"
import { status } from "./smoke/probes/status.ts"
import { subagents } from "./smoke/probes/subagents.ts"
import { trail } from "./smoke/probes/trail.ts"
import { trust } from "./smoke/probes/trust.ts"
import { updater } from "./smoke/probes/updater.ts"

const mode = readMode()
console.log(`smoke against OpenCode ${v2 ? "2" : "1"} (${opencode}), install: ${mode}`)
const install = await prepare(mode)
const all = install.bays.length > 1
/** Setup's palette entry comes with every interface entry, so its probe always runs. */
const here = (probe: Probe) => probe.name === "setup" || install.bays.includes(probe.name)
const stage = async (step: "open" | "palette" | "slash" | "apart", probes: Probe[]) => {
  for (const probe of probes) if (here(probe)) await probe[step]?.(install)
}

try {
  launch(install.env, install.project)
  await Bun.sleep(14_000) // OpenCode start-up, plugin install and load
  await stage("open", [shell, status, review])

  /**
   * Every installed bay's commands must be found by typing "cockpit" and the bay, and one command per
   * bay (palette-only where the bay has one) must show its effect. A bay installed alone must not
   * bring the others: their entries are not listed at all.
   */
  const probes = [shell, status, review, updater, subagents, trail, trust, setup]
  for (const probe of probes) {
    const listed = await search(`cockpit ${probe.name}`)
    keep(listed)
    if (here(probe))
      expect(listed.includes(probe.listed), `"cockpit ${probe.name}" never listed "${probe.listed}"`, listed)
    else
      expect(
        !listed.includes(probe.listed),
        `"cockpit ${probe.name}" listed "${probe.listed}", not installed`,
        listed,
      )
  }
  await settle()
  await stage("palette", [review, subagents, trust, updater, trail])
  pass(
    all
      ? `every bay and /cockpit-setup found under "cockpit" in the palette, and the commands ran from there`
      : `${mode} and /cockpit-setup found under "cockpit" in the palette, no other bay, and the commands ran from there`,
  )
  /** Status's AGENT=1 step starts a turn, so it is last. */
  await stage("slash", [updater, subagents, setup, status])
  kill()

  /**
   * AGENT=1: the sidebar of a conversation nothing has happened in — every block that lists something
   * has to say it is there while it is empty, the heading and `none yet`, under the Status table.
   */
  if (canPresence(install)) {
    const drawn = await presence(install)
    for (const probe of probes) if (here(probe)) probe.empty?.(drawn)
    pass(
      all
        ? "an empty sidebar said none yet in every block, under the Status table"
        : `an empty sidebar drew ${mode}'s block as it should`,
    )
  }
  await stage("apart", [status])
  noPluginFailed()

  if (agent) {
    const asks = [shell, review, subagents, ...(install.agentSide ? [setup] : [])]
      .filter(here)
      .flatMap((probe) => (probe.ask ? [probe.ask] : []))
    if (asks.length > 0) {
      agentTurn(install, asks)
      pass(
        all
          ? "an agent called the bays' tools and was told about them"
          : "an agent called the tools and was told about them",
      )
    }
    const measured = [trail, shell, review].filter((probe) => here(probe) && probe.measure)
    for (const probe of measured) probe.measure?.(install)
    const names = measured.map((probe) => `${probe.name[0]?.toUpperCase()}${probe.name.slice(1)}'s`)
    if (names.length > 0)
      pass(
        `${[names.slice(0, -1).join(", "), names.at(-1)].filter(Boolean).join(" and ")} ${names.length > 1 ? "measurements" : "measurement"} passed`,
      )
  }
  console.log(`tui smoke passed (${mode}): ${passed.join("; ")}`)
} finally {
  /** A probe that failed left its OpenCode running. */
  kill()
  /** KEEP=1 leaves the install and project behind, to inspect what a run actually loaded. */
  if (process.env.KEEP) console.log(`kept ${install.work}`)
  else rmSync(install.work, { recursive: true, force: true })
}
