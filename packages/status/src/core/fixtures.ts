/**
 * Sample sessions to draw a statusline against, without an OpenCode to draw it in.
 *
 * Designing a statusline by editing TypeScript, restarting OpenCode and looking is a loop measured
 * in minutes; one sidebar cost roughly twenty restarts. These are the states worth checking a
 * design against — and the ones a design usually gets wrong, because they are the states you are
 * not in while you are designing.
 */

import type { SessionSnapshot, StatusContext } from "./context.ts"

export type FixtureName =
  | "fresh"
  | "working"
  | "busy"
  | "uncached"
  | "full"
  | "unpriced"
  | "retrying"
  | "empty"

/** Two days and fifteen hours after the session was created: a conversation reopened, not a new one. */
const NOW = 2 * 24 * 3600_000 + 15 * 3600_000

const session = (over: Partial<SessionSnapshot> = {}): SessionSnapshot => ({
  id: "ses_preview",
  title: "A session",
  status: "idle",
  cost: 0.42,
  priced: true,
  messages: 8,
  startedAt: 0,
  // The last answer: asked six minutes ago, finished in 3m42s.
  turn: { startedAt: NOW - 360_000, endedAt: NOW - 360_000 + 222_000 },
  model: { providerID: "anthropic", modelID: "claude-opus-5-20260101", contextLimit: 200_000 },
  tokens: { input: 265, output: 60, reasoning: 0, cache: { read: 84_900, write: 0 } },
  diff: { files: 3, additions: 42, deletions: 7 },
  todo: { total: 5, completed: 2 },
  ...over,
})

const base = (over: Partial<StatusContext> = {}): StatusContext => ({
  now: NOW,
  directory: "/Users/you/code/checkout-service/src",
  worktree: "/Users/you/code/checkout-service",
  home: "/Users/you",
  branch: "feature/checkout",
  defaultBranch: "main",
  /** The branch against where it forked: more than this session touched, and there with no session. */
  branchDiff: { files: 5, additions: 312, deletions: 48 },
  version: "0.3.0",
  lsp: [{ name: "tsserver", status: "connected" }],
  mcp: [{ name: "github", status: "connected" }],
  commands: {},
  width: 120,
  ...over,
})

/** Each one is a state a design has to survive, not merely a different set of numbers. */
export const FIXTURES: Record<FixtureName, { about: string; ctx: StatusContext }> = {
  /** Before the first reply: no model, no tokens, no cost. Most designs render a wall of zeroes. */
  fresh: {
    about: "a new session, before the first reply",
    ctx: base({
      session: session({
        messages: 0,
        cost: 0,
        priced: false,
        model: undefined,
        tokens: undefined,
        turn: undefined,
        diff: { files: 0, additions: 0, deletions: 0 },
        todo: { total: 0, completed: 0 },
      }),
    }),
  },
  /** The ordinary case: a few turns in, mostly cache. */
  working: { about: "a few turns in, mostly served from cache", ctx: base({ session: session() }) },
  /** A turn running: the clock that matters is this one, and it is counted once. */
  busy: {
    about: "a turn running, a minute in",
    ctx: base({
      session: session({ status: "busy", turn: { startedAt: NOW - 62_000, endedAt: NOW - 20_000 } }),
    }),
  },
  /**
   * No prompt cache at all, on a big window — a real session on a work machine. Every cache figure
   * is zero, which a column of `Cache 0 · 0%` and `Write 0 · 0%` rows said at length.
   */
  uncached: {
    about: "no prompt cache, a 1.3M window, 13% full",
    ctx: base({
      session: session({
        cost: 1.81,
        model: { providerID: "litellm", modelID: "claude-opus-5", contextLimit: 1_300_000 },
        tokens: { input: 167_300, output: 472, reasoning: 0, cache: { read: 0, write: 0 } },
      }),
    }),
  },
  /** Nearly out of room, which is when the design has to shout. */
  full: {
    about: "the context nearly full, a long session",
    ctx: base({
      branchDiff: { files: 28, additions: 1_840, deletions: 620 },
      session: session({
        cost: 26.24,
        tokens: { input: 4_200, output: 2_100, reasoning: 900, cache: { read: 181_000, write: 3_400 } },
        diff: { files: 28, additions: 1_840, deletions: 620 },
        todo: { total: 9, completed: 9 },
      }),
    }),
  },
  /** Behind a proxy: tokens flow, but nobody declared prices or a window. */
  unpriced: {
    about: "behind a proxy — no declared prices or context window",
    ctx: base({
      session: session({
        priced: false,
        cost: 0,
        model: { providerID: "litellm", modelID: "claude-opus-5" },
      }),
    }),
  },
  /** Stalled, which OpenCode itself shows only as a spinner — and an MCP server that would not start. */
  retrying: {
    about: "a stalled turn, retrying, and a broken MCP server",
    ctx: base({
      now: 1_000,
      mcp: [
        { name: "github", status: "connected" },
        { name: "linear", status: "failed" },
      ],
      session: session({
        status: "retry",
        startedAt: 0,
        turn: { startedAt: 0 },
        retry: { attempt: 2, message: "rate limited", next: 6_000 },
      }),
    }),
  },
  /** Off a session route entirely: everything session-shaped must stay quiet. */
  empty: { about: "no session at all", ctx: base() },
}
