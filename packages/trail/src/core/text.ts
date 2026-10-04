/**
 * Everything the agent reads from Trail: the tools' descriptions, the guidance in its system prompt,
 * the two per-conversation lines added on every request, and what `trail_add` and `trail_list`
 * answer. Written to be read by a model (principles.md, rule 3) — what changed first, then what to
 * do next — and drawn from the same `arrange` as the dialog (rule 2).
 *
 * Why the guidance carries the examples: OpenCode 2 shows a plugin tool's description cut to about
 * 115 characters in its Code Mode catalog (docs/opencode/trail-server.md), so the description says
 * *when* to call in its first sentence, and the examples live in the system prompt, which every
 * request carries whole. It names `tools.trail_add`, so a model in Code Mode can call it without
 * searching the catalog first.
 */

import {
  type Arranged,
  arrange,
  conversationThings,
  type Found,
  lastOf,
  linesOf,
  projectThings,
  type Thing,
} from "./model.ts"
import { historyText, type State } from "./store.ts"
import { ago, cut } from "./view/rows.ts"

/* ─── the tools ──────────────────────────────────────────────────────────────────────────────── */

/** When to call, first: on OpenCode 2 the catalog shows only the first ~115 characters. */
export const ADD_DESCRIPTION = `Call right after you create or change something outside this repo — a PR, ticket, doc page, deploy — to record it. \
The trail is how the user finds, later, what this conversation made, and which conversation made it. \
One call per thing; calling again with the same url updates its record (a better title fixes it). \
Required: title, and url or ref.`

export const ADD_ARGS = {
  title: "The thing's own title, as a person would recognise it: the PR's title, the page's title. Required.",
  url: "The link that opens it (http/https). Give url, ref, or both.",
  ref: 'The name people search for: "COM-1736", "owner/repo#33", a commit hash. Read from GitHub PR and issue links when left out.',
  kind: 'What it is, in your words: "pull request", "Confluence page", "deploy".',
  action:
    "What you did: created, updated, merged, published… Defaults to created, or updated when it is already in the trail.",
  for: 'The ref or url of what this belongs to — the ticket a PR is for: "COM-1736".',
  note: "One optional line worth keeping.",
} as const

export const LIST_DESCRIPTION = `What this conversation recorded with trail_add (PRs, tickets, pages, deploys) — or, with all, every conversation in this project, and which one made each. \
query filters by title, ref, kind or system (GitHub, Jira…). Use it to answer "what did we make for COM-1736?" or "which conversation opened the auth PR?".`

export const LIST_ARGS = {
  all: "true: every conversation in this project, not only this one.",
  query: 'Words that must all appear in the title, ref, kind or system, e.g. "COM-1736" or "jira".',
} as const

/** The system-prompt guidance: always loaded, subagents included. */
export const GUIDANCE = `## Trail (opencode-cockpit)
When you create or change something outside this repository's files — a pull request, a ticket, a doc page, an artifact, a deploy — record it right away with trail_add (in Code Mode: \`await tools.trail_add({...})\`). Use the thing's own title and its link; when the work is for a ticket or epic, put its key in \`for\` so the record groups under it. A subagent records what it makes itself.
  tools.trail_add({ title: "Fix bundle desync on reconnect", url: "https://github.com/acme/web/pull/33", action: "created", for: "COM-1736" })
  tools.trail_add({ title: "Release notes for 0.8", url: "https://acme.atlassian.net/wiki/x/AbC123", kind: "Confluence page", action: "updated" })
Not for files in this repository, or for links you only read or printed. Before saying what this work produced, call trail_list (all, query) — don't answer from memory.`

/* ─── naming a thing ─────────────────────────────────────────────────────────────────────────── */

/** `PR #33 "Fix bundle desync"` — how a sentence names a thing. */
export function named(thing: Pick<Thing, "label" | "title">, room = 80): string {
  const title = `"${cut(thing.title, room)}"`
  return thing.label ? `${thing.label} ${title}` : title
}

/** `by subagent explore`, `added by you`, or nothing for the agent itself. */
function whoText(touch: { by: string; subagent?: string }): string {
  if (touch.by === "you") return "added by you"
  return touch.subagent ? `by subagent ${touch.subagent}` : ""
}

/* ─── trail_add's answer ─────────────────────────────────────────────────────────────────────── */

export interface Added {
  thing: Thing
  /** It was already in this conversation's trail. */
  merged: boolean
  /** How many things this conversation's trail holds now. */
  count: number
  stripped: string[]
  /** The `for` names nothing this conversation recorded. */
  forMissing?: string
}

/** What `trail_add` answers: what changed, then anything to know. */
export function addedText(added: Added): string {
  const { thing } = added
  const where = thing.system ? ` (${thing.system})` : ""
  const lines = [
    added.merged
      ? `Updated the existing record of ${named(thing)}${where}: ${historyText(thing)}. Recording the same url again never makes a second row.`
      : `Recorded ${named(thing)}${where} — ${lastOf(thing).action}.`,
  ]
  lines.push(
    `This conversation's trail holds ${added.count} ${added.count === 1 ? "thing" : "things"}; the user sees it in the sidebar and /trail.`,
  )
  if (added.stripped.length > 0)
    lines.push(
      `Removed from the link before storing, because it looked like a secret: ${added.stripped.join(", ")}.`,
    )
  if (added.forMissing)
    lines.push(
      `"${added.forMissing}" is not in this conversation's trail itself; if this conversation created or changed it, record it too.`,
    )
  return lines.join("\n")
}

/* ─── trail_list's answer ────────────────────────────────────────────────────────────────────── */

export interface ListInput {
  state: State
  /** The conversation asking. */
  session: string
  all: boolean
  query: string
  now: number
}

function thingLine(thing: Thing, depth: number, input: ListInput): string[] {
  const last = lastOf(thing)
  const facts = [
    named(thing, 120),
    ...(thing.ref && thing.ref !== thing.label ? [thing.ref] : []),
    ...(thing.system ? [thing.system] : []),
    ...(thing.kind && thing.kind !== thing.label ? [thing.kind] : []),
  ]
  const indent = "  ".repeat(depth)
  const lines = [`${indent}- ${facts.join(" · ")}`]
  if (!input.all) {
    const touch = thing.touches[0]
    const who = touch ? whoText(touch) : ""
    lines[0] += ` · ${historyText(thing)} ${ago(input.now - last.at)}${who ? ` · ${who}` : ""}`
  }
  if (thing.url) lines.push(`${indent}  ${thing.url}`)
  if (thing.note) lines.push(`${indent}  note: ${thing.note}`)
  if (input.all)
    for (const touch of thing.touches) {
      const title = touch.title ? `"${cut(touch.title, 60)}"` : "untitled"
      const marks = [touch.session, ...(touch.deleted ? ["deleted"] : [])].join(", ")
      const who = whoText(touch)
      lines.push(
        `${indent}  in ${title} (${marks}) — ${historyText(touch)} ${ago(input.now - (touch.history.at(-1)?.at ?? touch.lastAt))}${who ? ` · ${who}` : ""}${touch.session === input.session ? " — this conversation" : ""}`,
      )
    }
  return lines
}

/** The trail as `trail_list` answers it: the same groups and order as `/trail`. */
export function listText(input: ListInput): string {
  const things = input.all ? projectThings(input.state) : conversationThings(input.state, input.session)
  const arranged = arrange(things, input.query)
  const scope = input.all ? "this project's conversations" : "this conversation"
  if (arranged.total === 0)
    return input.all
      ? "Nothing is in the trail for this project yet. Record what you create or change outside the repository with trail_add."
      : "Nothing is in this conversation's trail yet. If it created or changed something outside the repository — a PR, a ticket, a page — record it with trail_add. trail_list with all: true looks across the project's other conversations."
  if (arranged.shown === 0)
    return `Nothing in ${scope} matches "${input.query}" (searched title, ref, kind and system). ${input.all ? "Try fewer words." : "Try all: true for every conversation, or fewer words."}`
  const count = input.query
    ? `${arranged.shown} of ${arranged.total} things`
    : `${arranged.total} ${arranged.total === 1 ? "thing" : "things"}`
  const order = arranged.shown > 1 ? ", grouped by what they are for, newest work first" : ""
  const head = `${count} in ${scope}${input.query ? ` matching "${input.query}"` : ""}${order}:`
  return [head, ...bodyLines(arranged, input)].join("\n")
}

function bodyLines(arranged: Arranged, input: ListInput): string[] {
  const out: string[] = []
  for (const line of linesOf(arranged))
    if (line.kind === "head") out.push(`- ${line.name} (not recorded itself)`)
    else out.push(...thingLine(line.thing, line.depth, input))
  return out
}

/* ─── the lines added to every request ───────────────────────────────────────────────────────── */

/** How many things the "produced" line names before `+ N more`. */
export const PRODUCED_LIMIT = 6

/**
 * What this conversation produced, in one line, rebuilt from the trail on every request — so it
 * survives compaction (a summary once said trail_add was never called when it had been). Nothing
 * when nothing is recorded: the guidance already says what to do.
 */
export function producedLine(state: State, session: string): string | undefined {
  const lines = linesOf(arrange(conversationThings(state, session))).flatMap((line) =>
    line.kind === "thing" ? [line.thing] : [],
  )
  if (lines.length === 0) return undefined
  const shown = lines.slice(0, PRODUCED_LIMIT).map((thing) => `${named(thing, 50)} (${historyText(thing)})`)
  const more = lines.length - shown.length
  return `Trail — this conversation produced: ${shown.join("; ")}${more > 0 ? `; + ${more} more (trail_list)` : ""}.`
}

/** How many links the reminder names at most. */
export const SEEN_LIMIT = 5

/**
 * The safety net's reminder: PR and issue links in the output of something the agent ran, not yet
 * recorded. Worded as a choice — both models declined to record a link they had only printed, and
 * that is right; the trail is what the conversation made.
 */
export function seenLine(found: readonly Found[]): string | undefined {
  if (found.length === 0) return undefined
  const urls = found.slice(0, SEEN_LIMIT).map((each) => each.url)
  const more = found.length - urls.length
  return `Seen in output — record it with tools.trail_add if you created or changed it: ${urls.join(", ")}${more > 0 ? ` (+ ${more} more)` : ""}`
}

/* ─── copy as markdown ───────────────────────────────────────────────────────────────────────── */

const escapeMd = (text: string) => text.replace(/([\\[\]])/g, "\\$1")

function markdownItem(thing: Thing, depth: number): string {
  const name = thing.label ? `${thing.label} — ${thing.title}` : thing.title
  const link =
    thing.openable && thing.url ? `[${escapeMd(name)}](${thing.url.replace(/\)/g, "%29")})` : escapeMd(name)
  const facts = [...(thing.system ? [thing.system] : []), historyText(thing)]
  return `${"  ".repeat(depth)}- ${link} · ${facts.join(" · ")}`
}

/** A trail as a markdown list — for a PR description, a standup, a ticket comment. */
export function markdownOf(arranged: Arranged): string {
  const out: string[] = []
  for (const line of linesOf(arranged))
    out.push(line.kind === "head" ? `- **${escapeMd(line.name)}**` : markdownItem(line.thing, line.depth))
  return out.join("\n")
}
