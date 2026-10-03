/**
 * `trail_add`'s arguments, checked and cleaned into an event — the one door into the trail, for the
 * agent's tool and for a person's `/link` and `a` alike.
 *
 * The shape is generic on purpose (docs/roadmap/v0.9/trail.md): nothing but a `title` and one of
 * `url` / `ref` is required, and everything else is free text in the caller's own words. So the
 * checks are few, and each failure is written for a model to act on (principles.md, rule 3): it
 * says what was wrong, that nothing was recorded, and what to send instead.
 */

import { cleanUrl, httpUrl, workOf } from "./links.ts"
import { type By, type Event, type Fields, matchRecord, newId, type State } from "./store.ts"

/** The longest each field is kept; longer is cut with `…`, not refused. */
export const LIMITS = { title: 200, url: 2000, ref: 120, kind: 60, action: 60, for: 200, note: 300 } as const

const FIELDS = ["title", "url", "ref", "kind", "action", "for", "note"] as const
type Field = (typeof FIELDS)[number]

export type Checked =
  | {
      ok: true
      /** `action` left out when the caller left it out: it depends on what the trail already holds. */
      fields: Omit<Fields, "action"> & { action?: string }
      /** Query parameters taken out of the link because they looked like secrets. */
      stripped: string[]
    }
  | { ok: false; error: string }

const NOTHING = "Nothing was recorded."

/** One line of text: whitespace runs (newlines included) become one space; too long is cut. */
function line(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat
}

/** `github.com/o/r/pull/1` is a link someone forgot the scheme of; `file:` and the like are not links. */
function withScheme(text: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return text
  return /^[\w-]+(\.[\w-]+)+(:\d+)?(\/|$)/.test(text) ? `https://${text}` : text
}

export function checkAdd(args: unknown): Checked {
  if (!args || typeof args !== "object" || Array.isArray(args))
    return {
      ok: false,
      error: `trail_add takes an object: { title, url?, ref?, kind?, action?, for?, note? }. ${NOTHING}`,
    }
  const raw = args as { [key: string]: unknown }
  const given: Partial<{ [K in Field]: string }> = {}
  for (const field of FIELDS) {
    const value = raw[field]
    if (value === undefined || value === null) continue
    if (typeof value === "number") given[field] = String(value)
    else if (typeof value === "string") given[field] = value
    else
      return {
        ok: false,
        error: `trail_add: \`${field}\` must be text, got ${Array.isArray(value) ? "a list" : typeof value}. ${NOTHING} Send one record per call.`,
      }
  }
  const fields: Partial<{ [K in Field]: string }> = {}
  for (const field of FIELDS) {
    const value = given[field]
    if (value === undefined) continue
    const cleaned = line(value, LIMITS[field])
    if (cleaned) fields[field] = cleaned
  }

  if (!fields.title)
    return {
      ok: false,
      error: `trail_add needs a \`title\`: the thing's own name, as a person would recognise it — the PR's title, the page's title, the ticket's summary. ${NOTHING} Call it again with a title.`,
    }

  let stripped: string[] = []
  if (fields.url) {
    const url = httpUrl(withScheme(fields.url))
    if (!url)
      return {
        ok: false,
        error: `trail_add: \`url\` must be an http(s) link, and "${fields.url}" is not one. ${NOTHING} For something with no web page — a commit, a local file — leave url out and pass \`ref\` (a commit hash, a path).`,
      }
    const cleaned = cleanUrl(url)
    fields.url = cleaned.url
    stripped = cleaned.stripped
  }
  if (!fields.url && !fields.ref)
    return {
      ok: false,
      error: `trail_add needs a \`url\` (the link to open it) or a \`ref\` (the name people search for: "COM-1736", "owner/repo#33", a commit hash). ${NOTHING} Call it again with at least one.`,
    }
  /** A PR or issue link names itself: `owner/repo#33`, unless the caller named it already. */
  if (fields.url && !fields.ref) {
    const work = workOf(fields.url)
    if (work) fields.ref = work.ref
  }
  return {
    ok: true,
    fields: fields as Omit<Fields, "action"> & { action?: string },
    stripped,
  }
}

export interface Who {
  /** The session the call was made in. */
  session: string
  /** The conversation: the root session. */
  rootSession: string
  sessionTitle?: string
  by: By
  subagent?: string
  at: number
  id?: string
}

/**
 * The event a checked call becomes. Unsaid, the action is `created` for a thing new to this
 * conversation and `updated` for one it has recorded already.
 */
export function recordedEvent(
  fields: Omit<Fields, "action"> & { action?: string },
  who: Who,
  state: State,
): Extract<Event, { type: "recorded" }> {
  const known = matchRecord(state, who.rootSession, fields.url, fields.ref) !== undefined
  return {
    v: 1,
    at: who.at,
    id: who.id ?? newId(),
    type: "recorded",
    rootSession: who.rootSession,
    session: who.session,
    ...(who.sessionTitle ? { sessionTitle: who.sessionTitle } : {}),
    by: who.by,
    ...(who.subagent ? { subagent: who.subagent } : {}),
    ...fields,
    action: fields.action ?? (known ? "updated" : "created"),
  }
}

export interface ListArgs {
  all: boolean
  query: string
}

/** `trail_list`'s arguments: both optional, and forgiving — `"all": "true"` means what it says. */
export function checkList(args: unknown): ListArgs {
  const raw = (args && typeof args === "object" ? args : {}) as { [key: string]: unknown }
  const all = raw.all === true || raw.all === "true" || raw.all === "all"
  const query = typeof raw.query === "string" ? line(raw.query, 200) : ""
  return { all, query }
}
