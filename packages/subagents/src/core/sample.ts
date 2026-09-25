/**
 * A run caught mid-flight, for the preview: build has launched three subagents — one searching, one
 * held on a permission, one finished. Fixed times, so the preview draws the same thing every time.
 */

import type { Change } from "./model/changes.ts"

export const SAMPLE_ROOT = "ses_build"
export const SAMPLE_NOW = 1_790_000_060_000

export function sample(): Change[] {
  const t = (s: number) => SAMPLE_NOW - 60_000 + s * 1000
  return [
    {
      type: "session",
      id: SAMPLE_ROOT,
      agent: "build",
      title: "Refactor auth and fix login tests",
      at: t(0),
    },

    {
      type: "session",
      id: "ses_explore",
      parentID: SAMPLE_ROOT,
      agent: "explore",
      title: "Map the authentication flow",
      at: t(9),
    },
    {
      type: "prompt",
      id: "ses_explore",
      key: "u1",
      text: "Map how a session is created, read and destroyed in src/auth. List every caller of requireSession.",
      at: t(9),
    },
    { type: "status", id: "ses_explore", status: "busy", at: t(9) },
    {
      type: "thinking",
      id: "ses_explore",
      key: "r1",
      text: "Start with the file tree, then session.ts — the name suggests it owns the lifecycle. The middleware probably reads it per request. I'll grep for requireSession afterwards to find the callers.",
      done: true,
      at: t(10),
    },
    {
      type: "tool",
      id: "ses_explore",
      call: "c1",
      name: "glob",
      state: "completed",
      input: { pattern: "src/auth/**/*.ts" },
      output: "23 files",
      at: t(12),
    },
    { type: "tool", id: "ses_explore", call: "c1", at: t(12) },
    {
      type: "tool",
      id: "ses_explore",
      call: "c2",
      name: "read",
      state: "completed",
      input: { filePath: "/acme/src/auth/session.ts" },
      at: t(13),
    },
    {
      type: "tool",
      id: "ses_explore",
      call: "c3",
      name: "read",
      state: "completed",
      input: { filePath: "/acme/src/auth/middleware.ts" },
      at: t(14),
    },
    {
      type: "thinking",
      id: "ses_explore",
      key: "r2",
      text: "createSession and readSession are the two entry points. Need to confirm where tokens are refreshed.",
      done: true,
      at: t(16),
    },
    {
      type: "tool",
      id: "ses_explore",
      call: "c4",
      name: "grep",
      state: "running",
      input: { pattern: "session", include: "src/auth/**" },
      output:
        "src/auth/session.ts:14: export function createSession(user: User) {\nsrc/auth/session.ts:41: export function readSession(req: Request) {\nsrc/auth/middleware.ts:7: const session = readSession(req)",
      at: t(56),
    },
    {
      type: "reply",
      id: "ses_explore",
      key: "t1",
      delta: "So far: sessions are created in session.ts:14 and read per request by the middleware, and",
      at: t(57),
    },
    { type: "usage", id: "ses_explore", tokens: 6100, cost: 0.004, at: t(57) },

    {
      type: "session",
      id: "ses_login",
      parentID: SAMPLE_ROOT,
      agent: "general",
      title: "Fix the failing login test",
      at: t(10),
    },
    {
      type: "prompt",
      id: "ses_login",
      key: "u1",
      text: "The login test fails after the session refactor. Find out why and fix it.",
      at: t(10),
    },
    { type: "status", id: "ses_login", status: "busy", at: t(10) },
    {
      type: "tool",
      id: "ses_login",
      call: "l1",
      name: "read",
      state: "completed",
      input: { filePath: "/acme/test/login.test.ts" },
      at: t(12),
    },
    {
      type: "tool",
      id: "ses_login",
      call: "l2",
      name: "edit",
      state: "completed",
      input: { filePath: "/acme/test/login.test.ts" },
      at: t(30),
    },
    {
      type: "tool",
      id: "ses_login",
      call: "l3",
      name: "bash",
      state: "pending",
      input: { command: "npm test -- login" },
      at: t(58),
    },
    { type: "status", id: "ses_login", status: "waiting", at: t(58) },
    { type: "usage", id: "ses_login", tokens: 3900, cost: 0.003, at: t(58) },

    {
      type: "session",
      id: "ses_readme",
      parentID: SAMPLE_ROOT,
      agent: "general",
      title: "Update README for the new auth API",
      at: t(11),
    },
    {
      type: "prompt",
      id: "ses_readme",
      key: "u1",
      text: "Update the README's auth section for the new session API.",
      at: t(11),
    },
    { type: "status", id: "ses_readme", status: "busy", at: t(11) },
    {
      type: "tool",
      id: "ses_readme",
      call: "d1",
      name: "read",
      state: "completed",
      input: { filePath: "/acme/README.md" },
      at: t(13),
    },
    {
      type: "tool",
      id: "ses_readme",
      call: "d2",
      name: "edit",
      state: "completed",
      input: { filePath: "/acme/README.md" },
      at: t(25),
    },
    {
      type: "tool",
      id: "ses_readme",
      call: "d3",
      name: "edit",
      state: "completed",
      input: { filePath: "/acme/README.md" },
      at: t(33),
    },
    {
      type: "reply",
      id: "ses_readme",
      key: "t1",
      text: "Updated the README's auth section: createSession, readSession and requireSession, with an example.",
      done: true,
      at: t(38),
    },
    { type: "status", id: "ses_readme", status: "idle", at: t(39) },
    { type: "usage", id: "ses_readme", tokens: 2200, cost: 0.001, at: t(39) },
  ]
}
