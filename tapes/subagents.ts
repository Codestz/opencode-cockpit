import { KEYS, type Tape } from "../scripts/record.ts"

/**
 * A subagent at work, watched: it shows up in the sidebar, its run opens beside the conversation, a
 * failing test run is a red box, and a question put to it straight from the pane gets answered — the
 * main agent told, without a turn spent on it.
 *
 *   OPENCODE=opencodeold bun scripts/record.ts tapes/subagents.ts
 *   bun scripts/tighten.ts tapes/subagents.cast 1.8
 *   agg --font-size 16 --theme asciinema --fps-cap 4 --idle-time-limit 1.5 tapes/subagents.cast media/subagents.gif
 *
 * Recorded on OpenCode 1 with the free Zen model, which needs no key. The model takes as long as it
 * takes, so the waits are generous and the silences are capped afterwards — check the cut before
 * publishing. Every keystroke is live; the project is the only thing prepared.
 */

const SESSION = `export interface Session {
  user: string
  expiresAt: number
}

const sessions = new Map<string, Session>()

export function createSession(token: string, user: string, ttlMs: number, now = Date.now()): Session {
  const session = { user, expiresAt: now + ttlMs }
  sessions.set(token, session)
  return session
}

/** A session is valid until the moment it expires. */
export function readSession(token: string, now = Date.now()): Session | undefined {
  const session = sessions.get(token)
  if (!session) return undefined
  if (session.expiresAt < now) return undefined
  return session
}
`

const TEST = `import { expect, test } from "bun:test"
import { createSession, readSession } from "./session.ts"

test("a session is gone at the moment it expires", () => {
  createSession("t1", "ada", 1000, 0)
  expect(readSession("t1", 999)?.user).toBe("ada")
  expect(readSession("t1", 1000)).toBeUndefined()
})
`

export default {
  name: "subagents",
  title: "A subagent at work, watched, and asked a question",
  cols: 124,
  rows: 34,
  model: "opencode/space-bunny-free",
  startupMs: 14_000,
  files: {
    "src/auth/session.ts": SESSION,
    "src/auth/session.test.ts": TEST,
  },
  setup: ["git init -q -b main", "git config user.email tape@example.com", "git config user.name Tape"],
  steps: [
    {
      send: "Use a general subagent to find out why src/auth/session.test.ts fails: run it with `bun test src/auth`, read the code, and explain the bug. Research only. Wait for it.",
      wait: 1500,
    },
    { send: KEYS.enter, wait: 12_000 },
    // the subagent is in the sidebar; open the one working now, beside the conversation, and watch
    { send: "\x18w", wait: 30_000 },
    // up to the start: the task it was given, and the test run that failed, in a red box
    { send: "g", wait: 4500 },
    // and back to the end of the run, where the answer is
    { send: "G", wait: 15_000 },
    // a question of your own, straight to the subagent
    { send: "m", wait: 900 },
    { send: "In one line: which exact comparison is wrong?", wait: 1500 },
    { send: KEYS.enter, wait: 30_000 },
    // back in the conversation: the exchange is there, and the main agent did not spend a turn on it
    { send: KEYS.esc, wait: 6000 },
  ],
} satisfies Tape
