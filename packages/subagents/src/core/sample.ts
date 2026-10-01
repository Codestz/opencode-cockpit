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
      type: "tool",
      id: "ses_explore",
      call: "c3b",
      name: "bash",
      state: "completed",
      input: { command: "git status --short", description: "Show changed files" },
      output: [
        "M CHANGELOG.md",
        " M src/auth/session.ts",
        " M src/auth/middleware.ts",
        " M src/auth/token.ts",
        " M src/routes/login.ts",
        " M src/routes/logout.ts",
        " M test/auth/session.test.ts",
        " M test/auth/login.test.ts",
        " M test/routes/login.test.ts",
        " M package.json",
        "?? src/auth/refresh.ts",
        "?? test/auth/refresh.test.ts",
      ].join("\n"),
      started: t(14),
      ended: t(15),
      at: t(14),
    },
    {
      type: "tool",
      id: "ses_explore",
      call: "c3c",
      name: "bash",
      state: "failed",
      input: { command: "git rev-parse --verify refs/heads/auth-refresh" },
      error: "fatal: Needed a single revision",
      started: t(15),
      ended: t(15),
      at: t(15),
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

// ---------------------------------------------------------------------------------------------------
// Sidebar ordering and nesting: two more conversations, each with its own root, on the same clock.

/** A run in a few changes: launched, a few calls, ended — or still in its last call. */
function run(
  id: string,
  parentID: string,
  agent: string,
  title: string,
  start: number,
  end: number | undefined,
  calls: number,
  ending: "idle" | "failed" = "idle",
): Change[] {
  const out: Change[] = [
    { type: "session", id, parentID, agent, title, at: start },
    { type: "prompt", id, key: "u1", text: title, at: start },
    { type: "status", id, status: "busy", at: start },
  ]
  for (let i = 0; i < calls; i++)
    out.push({
      type: "tool",
      id,
      call: `${id}:${i}`,
      name: "read",
      state: end === undefined && i === calls - 1 ? "running" : "completed",
      input: { filePath: `/acme/src/auth/file${i}.ts` },
      at: start + 500 + i * 500,
    })
  if (end !== undefined)
    out.push(
      ending === "failed"
        ? { type: "status", id, status: "failed", error: "rate limited", at: end }
        : { type: "status", id, status: "idle", at: end },
    )
  return out
}

export const ADVISOR_ROOT = "ses_plan"

/**
 * A subagent that asks an `advisor` for a second opinion again and again: six advisor sessions under
 * one planner, four finished — two long enough ago to have left the sidebar — and two still at it.
 * Beside it, a finished explore that had a helper of its own, long gone.
 */
export function advisorSample(): Change[] {
  const t = (s: number) => SAMPLE_NOW - 120_000 + s * 1000
  const planner = "ses_planner"
  const advise = (n: number, start: number, end?: number) =>
    run(
      `ses_advisor${n}`,
      planner,
      "advisor",
      "Review the migration plan",
      t(start),
      end === undefined ? undefined : t(end),
      1,
    )
  return [
    { type: "session", id: ADVISOR_ROOT, agent: "build", title: "Plan the session migration", at: t(0) },
    ...run("ses_scout", ADVISOR_ROOT, "explore", "Find every session read", t(2), t(30), 6),
    ...run("ses_scout_help", "ses_scout", "explore", "List the auth routes", t(5), t(12), 2),
    ...run(planner, ADVISOR_ROOT, "general", "Draft the migration plan", t(4), undefined, 5),
    ...advise(1, 10, 22),
    ...advise(2, 25, 40),
    ...advise(3, 60, 80),
    ...advise(4, 95, 104),
    ...advise(5, 110),
    ...advise(6, 114),
  ]
}

export const LATE_ROOT = "ses_late"

/**
 * Subagents that finished — one of them failed — then a late one still running, which used to sit
 * at the foot of the list under all of them. And one that finished while the subagent it launched in
 * the background is still working: that pair counts as working, and moves up with it.
 */
export function lateSample(): Change[] {
  const t = (s: number) => SAMPLE_NOW - 60_000 + s * 1000
  return [
    { type: "session", id: LATE_ROOT, agent: "build", title: "Tidy the auth module", at: t(0) },
    ...run("ses_l_map", LATE_ROOT, "explore", "Map the auth module", t(1), t(14), 7),
    ...run("ses_l_types", LATE_ROOT, "general", "Tighten the session types", t(3), t(25), 4),
    ...run("ses_l_bench", LATE_ROOT, "general", "Benchmark token refresh", t(5), t(9), 1, "failed"),
    ...run("ses_l_docs", LATE_ROOT, "general", "Document the middleware", t(6), t(20), 3),
    ...run("ses_l_bg", "ses_l_docs", "explore", "Collect examples in the background", t(18), undefined, 2),
    ...run("ses_l_tests", LATE_ROOT, "general", "Fix the flaky refresh test", t(42), undefined, 3),
  ]
}

/* ─── Calls of every kind ───────────────────────────────────────────────────────────────────── */

/**
 * One finished subagent whose run holds a call of every kind the pane draws differently: thinking
 * written as markdown, a todo list, an MCP tool with an object argument, a `task` that launched a
 * subagent of its own, and an `ask_advisor` whose question runs to sixty lines (issue #32).
 */
export const CALLS_ROOT = "ses_plan"
/** The MCP servers the preview pretends OpenCode has, so `context7_…` reads as one. */
export const CALLS_SERVERS = ["context7"]

const QUESTION = [
  "## Context",
  "",
  "I'm reviewing the **session refresh** refactor in `src/auth`. The plan moves token refresh out of",
  "the middleware and into a dedicated `refresh.ts`, called *lazily* when a request finds an expired",
  "access token. Before I sign off I'd like a second opinion on three points.",
  "",
  "## What the code does today",
  "",
  "- `requireSession` reads the cookie, verifies the JWT and attaches `req.session`",
  "- on expiry it calls `refreshToken(session)` *inline*, blocking the request",
  "- concurrent requests from the same tab can each trigger a refresh",
  "  - which means two refresh tokens are minted and one is ~~immediately~~ eventually revoked",
  "- logout clears the cookie but does not revoke the refresh token",
  "",
  "```ts",
  "export async function requireSession(req: Request): Promise<Session> {",
  "  const session = readSession(req)",
  "  if (!session) throw new Unauthorized()",
  "  if (session.expiresAt < Date.now()) return refreshToken(session)",
  "  return session",
  "}",
  "```",
  "",
  "## The proposed change",
  "",
  "1. A single-flight map keyed by refresh-token id, so concurrent requests share one refresh",
  "2. Refresh moves to `refresh.ts` and is called from the middleware only on expiry",
  "3. Logout revokes the refresh token server-side before clearing the cookie",
  "4. A grace window of 30s during which the *previous* access token is still accepted",
  "",
  "```ts",
  "const inflight = new Map<string, Promise<Session>>()",
  "",
  "export function refreshOnce(session: Session): Promise<Session> {",
  "  const key = session.refreshId",
  "  const running = inflight.get(key)",
  "  if (running) return running",
  "  const next = refreshToken(session).finally(() => inflight.delete(key))",
  "  inflight.set(key, next)",
  "  return next",
  "}",
  "```",
  "",
  "## Questions",
  "",
  "1. Is an in-process single-flight map enough, given we run **four** replicas behind a load",
  "   balancer without sticky sessions? Or does this need a shared lock (Redis) to be correct?",
  "2. Is the 30s grace window a security problem? A stolen access token stays valid 30s longer,",
  "   but only if it was stolen within the last 30s of its life.",
  "3. Should logout revoke *all* refresh tokens for the user, or only the one in this cookie?",
  "",
  "## Constraints",
  "",
  "- No new infrastructure this quarter; Redis exists but is owned by another team",
  "- The mobile app holds refresh tokens for 30 days and cannot be updated quickly",
  "- See [the RFC](https://example.com/rfc/42) for the original threat model",
  "",
  "> Please be blunt — if the plan is wrong I'd rather hear it now than after it ships.",
  "",
  "Thanks!",
].join("\n")

const THOUGHT = [
  "# Plan",
  "",
  "The refresh logic is the **risky** part. I should:",
  "",
  "- list the callers of `refreshToken`",
  "- check the middleware for a race",
  "- ask the advisor about the replica question",
  "",
  "The component that renders the session badge looks like this:",
  "",
  "```tsx",
  "export function SessionBadge({ session }: { session: Session }) {",
  '  return <span class="badge">{session.user.name}</span>',
  "}",
  "```",
  "",
  "Then write it up.",
].join("\n")

export function callsSample(): Change[] {
  const t = (s: number) => SAMPLE_NOW - 120_000 + s * 1000
  return [
    { type: "session", id: CALLS_ROOT, agent: "build", title: "Ship session refresh", at: t(0) },
    {
      type: "session",
      id: "ses_advise",
      parentID: CALLS_ROOT,
      agent: "general",
      title: "Review the session-refresh plan",
      at: t(1),
    },
    {
      type: "prompt",
      id: "ses_advise",
      key: "u1",
      text: "Review the session-refresh plan in docs/plans/refresh.md and get a second opinion on it.",
      at: t(1),
    },
    { type: "status", id: "ses_advise", status: "busy", at: t(1) },
    { type: "thinking", id: "ses_advise", key: "r1", text: THOUGHT, done: true, at: t(2) },
    {
      type: "tool",
      id: "ses_advise",
      call: "a1",
      name: "todowrite",
      state: "completed",
      input: {
        todos: [
          { content: "Read the refresh plan", status: "completed", priority: "high", id: "1" },
          { content: "List every caller of refreshToken", status: "completed", priority: "high", id: "2" },
          {
            content: "Check the middleware for a refresh race",
            status: "in_progress",
            priority: "high",
            id: "3",
          },
          {
            content: "Ask the advisor about replicas and the grace window",
            status: "pending",
            priority: "medium",
            id: "4",
          },
          { content: "Write up the review", status: "pending", priority: "low", id: "5" },
        ],
      },
      output: "",
      at: t(5),
    },
    {
      type: "tool",
      id: "ses_advise",
      call: "a2",
      name: "context7_query-docs",
      state: "completed",
      input: {
        libraryId: "/panva/jose",
        query: "verify a JWT and read its expiry",
        options: { tokens: 4000, topics: ["jwtVerify", "errors"], cache: true },
      },
      output:
        "jwtVerify(jwt, key, options) resolves { payload, protectedHeader }.\npayload.exp is seconds since the epoch.",
      started: t(6),
      ended: t(8),
      at: t(6),
    },
    {
      type: "tool",
      id: "ses_advise",
      call: "a3",
      name: "task",
      state: "completed",
      input: {
        description: "Scan for token refresh callers",
        prompt: "Find every caller of refreshToken in src/ and say which run per request.",
        subagent_type: "explore",
      },
      output:
        "task_id: ses_scan (for resuming to continue this task if needed)\n\n<task_result>\nThree callers…\n</task_result>",
      started: t(9),
      ended: t(30),
      at: t(9),
    },
    {
      type: "tool",
      id: "ses_advise",
      call: "a4",
      name: "ask_advisor",
      state: "completed",
      input: { question: QUESTION },
      output:
        "Short version: the in-process map is not enough with four replicas.\nUse the refresh token's own rotation as the lock: the second refresh fails, retry with the new token.",
      started: t(31),
      ended: t(62),
      at: t(31),
    },
    {
      type: "reply",
      id: "ses_advise",
      key: "t1",
      text: "## Review\n\nThe plan is **mostly sound**. The single-flight map only works per replica — see the advisor's note.",
      done: true,
      at: t(63),
    },
    { type: "status", id: "ses_advise", status: "idle", at: t(64) },
    { type: "usage", id: "ses_advise", tokens: 18_400, cost: 0.021, at: t(64) },

    {
      type: "session",
      id: "ses_scan",
      parentID: "ses_advise",
      agent: "explore",
      title: "Scan for token refresh callers (@explore subagent)",
      at: t(9),
    },
    {
      type: "prompt",
      id: "ses_scan",
      key: "u1",
      text: "Find every caller of refreshToken in src/.",
      at: t(9),
    },
    { type: "status", id: "ses_scan", status: "busy", at: t(9) },
    {
      type: "tool",
      id: "ses_scan",
      call: "s1",
      name: "grep",
      state: "completed",
      input: { pattern: "refreshToken", include: "src/**/*.ts" },
      output: "src/auth/middleware.ts:19\nsrc/auth/refresh.ts:4\nsrc/routes/login.ts:31",
      summary: "3 matches",
      at: t(10),
    },
    { type: "reply", id: "ses_scan", key: "t1", text: "Three callers.", done: true, at: t(29) },
    { type: "status", id: "ses_scan", status: "idle", at: t(30) },
  ]
}
