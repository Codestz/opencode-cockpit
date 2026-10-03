/**
 * Sample trails for the preview and the tests: the states a design gets wrong (testing.md) — none,
 * one, a busy conversation grouped by ticket, titles too long for any column, a project of several
 * conversations with one deleted, and links the agent printed but never recorded.
 *
 * Built through `runAdd`, the tool's own path, so a sample cannot hold a record the tool would not
 * have made.
 */

import { type Found, foundIn } from "./model.ts"
import { apply, emptyState, type State } from "./store.ts"
import { runAdd } from "./tools.ts"

export const SAMPLE_NOW = Date.UTC(2026, 9, 3, 15, 0, 0)
export const SAMPLE_SESSION = "ses_main"
export const SAMPLE_PROJECT = "opencode-cockpit"
const MIN = 60_000
const HOUR = 60 * MIN

export interface Sample {
  state: State
  session: string
  found: Found[]
}

interface Add {
  args: { [key: string]: string }
  ago: number
  session?: string
  title?: string
  subagent?: string
  by?: "agent" | "you"
}

function build(adds: readonly Add[], found: Found[] = []): Sample {
  const state = emptyState()
  /** Ids by position, so a sample is the same trail every time it is built. */
  let counter = 0
  for (const add of adds) {
    const session = add.session ?? SAMPLE_SESSION
    const out = runAdd(state, add.args, {
      session: add.subagent ? `${session}_child` : session,
      rootSession: session,
      sessionTitle: add.title ?? "Fix the bundle desync",
      by: add.by ?? "agent",
      ...(add.subagent ? { subagent: add.subagent } : {}),
      at: SAMPLE_NOW - add.ago,
      id: `ev_${++counter}`,
    })
    if (!out.ok) throw new Error(`sample: ${out.text}`)
  }
  return { state, session: SAMPLE_SESSION, found }
}

const PR33 = "https://github.com/Codestz/opencode-cockpit/pull/33"
const PR12 = "https://github.com/Codestz/opencode-cockpit-site/pull/12"
const TICKET = "https://acme.atlassian.net/browse/COM-1736"

const busy: Add[] = [
  {
    args: { title: "Bundle desync", url: TICKET, kind: "ticket", action: "updated" },
    ago: 2 * HOUR + 5 * MIN,
  },
  { args: { title: "Landing: Trust section", url: PR12, action: "created", for: "COM-1736" }, ago: 2 * HOUR },
  {
    args: { title: "0.8: Trust, one design system", url: PR33, action: "created", for: "COM-1736" },
    ago: 70 * MIN,
  },
  { args: { title: "0.8: Trust, one design system, and the sidebar order", url: PR33 }, ago: 62 * MIN },
  {
    args: {
      title: "Release notes for 0.8",
      url: "https://acme.atlassian.net/wiki/x/AbC123",
      kind: "Confluence page",
    },
    ago: 40 * MIN,
  },
  {
    args: { title: "Rollout checklist", url: "https://claude.ai/public/artifacts/9f2c", kind: "artifact" },
    ago: 30 * MIN,
    subagent: "docs",
  },
  {
    args: {
      title: "staging · web-portal",
      ref: "deploy 2026-10-03.4",
      kind: "deploy",
      note: "behind the flag",
    },
    ago: 25 * MIN,
  },
  {
    args: {
      title: "Retry the socket after sleep",
      url: "https://linear.app/acme/issue/ENG-42/retry-the-socket",
      for: "COM-1801",
    },
    ago: 15 * MIN,
  },
  {
    args: { title: "Bump the protocol version", ref: "a1b2c3d", kind: "commit", for: "COM-1801" },
    ago: 12 * MIN,
  },
  {
    args: {
      title: "Status page incident",
      url: "https://status.acme.dev/incidents/88?token=abc123&view=full",
      action: "published",
    },
    ago: 5 * MIN,
    by: "you",
  },
]

/** Printed by a command and never recorded: one PR the agent opened, one it only looked at. */
const FOUND: Found[] = [
  ...foundIn(
    "Created pull request: https://github.com/acme/web/pull/40\nSee also https://acme.atlassian.net/browse/COM-1800.",
    SAMPLE_NOW - 3 * MIN,
  ),
  ...foundIn(`Already recorded: ${PR33}`, SAMPLE_NOW - 2 * MIN),
]

const LONG = "A very long title that a person wrote because the change touched everything at once and said so"

/** The same PR in two conversations, a ticket in three, and one conversation since deleted. */
function project(): Sample {
  const sample = build([
    ...busy,
    {
      args: { title: "Bundle desync", url: TICKET, action: "commented" },
      ago: 3 * 24 * HOUR,
      session: "ses_older",
      title: "Investigate the reconnect bug",
    },
    {
      args: {
        title: "Reconnect spike",
        url: "https://github.com/Codestz/opencode-cockpit/pull/31",
        for: "COM-1736",
      },
      ago: 3 * 24 * HOUR - HOUR,
      session: "ses_older",
      title: "Investigate the reconnect bug",
    },
    {
      args: { title: "0.8: Trust, one design system", url: PR33, action: "reviewed" },
      ago: 20 * MIN,
      session: "ses_review",
      title: "Review the 0.8 branch",
    },
    {
      args: { title: "Old dashboard", url: "https://grafana.acme.dev/d/xyz", kind: "dashboard" },
      ago: 9 * 24 * HOUR,
      session: "ses_gone",
      title: "Set up the latency dashboard",
    },
  ])
  apply(sample.state, {
    v: 1,
    at: SAMPLE_NOW - 24 * HOUR,
    id: "ev_deleted",
    type: "deleted",
    rootSession: "ses_gone",
  })
  return sample
}

export const SAMPLES: { [name: string]: () => Sample } = {
  empty: () => build([]),
  one: () => build([{ args: { title: "0.8: Trust, one design system", url: PR33 }, ago: 4 * MIN }]),
  busy: () => build(busy, FOUND),
  long: () =>
    build([
      { args: { title: LONG, url: PR33, for: "COM-1736-WITH-A-VERY-LONG-KEY" }, ago: 50 * MIN },
      {
        args: {
          title: LONG,
          ref: "a-reference-that-goes-on-and-on-and-on",
          kind: "a kind described at great length",
          action: "created, then reopened, then merged",
        },
        ago: 3 * 24 * HOUR,
      },
      {
        args: {
          title: "最終リリースノート — 日本語のタイトル",
          url: "https://acme.atlassian.net/wiki/x/JP1",
        },
        ago: 9 * MIN,
      },
    ]),
  project,
}
