/**
 * A probe: one bay's steps against a real OpenCode, and what each has to show. The entry runs every
 * probe's steps a stage at a time — so all of them share one OpenCode — and only for bays installed.
 */

import type { Feature as Bay } from "../../packages/opencode/src/features.ts"
import type { AgentAsk } from "./agent.ts"
import type { Install } from "./install.ts"

export interface Probe {
  /** The bay it proves, or `setup`, whose palette entry every interface entry offers. */
  name: Bay | "setup"
  /** What typing "cockpit <name>" into the palette has to list. */
  listed: string
  /** In the project's OpenCode, first: what the bay draws, and its own keys. */
  open?(install: Install): Promise<void>
  /** Its commands, run from the palette, once the screen is at rest. */
  palette?(install: Install): Promise<void>
  /** Its slash names; then the AGENT=1 steps that start a turn. */
  slash?(install: Install): Promise<void>
  /** In an OpenCode of its own, once the project's is closed. */
  apart?(install: Install): Promise<void>
  /** AGENT=1: the sidebar of a conversation nothing has happened in. */
  empty?(drawn: string): void
  /** AGENT=1: what the agent turn has to call, and be told. */
  ask?: AgentAsk
  /** AGENT=1: its behaviour measurement. */
  measure?(install: Install): void
}
