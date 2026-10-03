/**
 * What a link says about itself: whether it is safe to keep and to open, which system it belongs to,
 * and the name people know the thing by.
 *
 * **The system comes from the link, not from the agent's `kind`.** A fixed list of kinds broke on the
 * first Confluence page; a host does not. `SYSTEMS` is the whole table — a row per host (and path,
 * where one host serves two products) — and anything not in it is shown as its bare domain, so a new
 * tool needs no change here to be readable and searchable.
 *
 * **Safe links.** Only `http(s)` is ever opened. A link is cleaned before it is stored: credentials in
 * it (`user:pass@`) and query parameters that look like secrets (`token`, `sig`, `X-Amz-Signature`…)
 * are dropped, because the trail lives on disk in plain text and is copied into PR descriptions.
 */

export interface System {
  /** The host, or a suffix of it when it starts with a dot (`.atlassian.net`). */
  host: string
  /** Only links whose path starts with this. */
  path?: string
  name: string
}

/** First match wins: a row with a path goes before the row for the same host without one. */
export const SYSTEMS: readonly System[] = [
  { host: "github.com", name: "GitHub" },
  { host: "gist.github.com", name: "GitHub" },
  { host: "gitlab.com", name: "GitLab" },
  { host: ".atlassian.net", path: "/wiki", name: "Confluence" },
  { host: ".atlassian.net", path: "/browse/", name: "Jira" },
  { host: ".atlassian.net", path: "/jira/", name: "Jira" },
  { host: "claude.ai", name: "Claude" },
  { host: "linear.app", name: "Linear" },
]

/** `www.` says nothing; the rest of the host is the name of the place. */
const bare = (host: string) => host.replace(/^www\./, "")

/** A parsed `http(s)` link, or nothing. */
export function httpUrl(text: string | undefined): URL | undefined {
  if (!text) return undefined
  try {
    const url = new URL(text)
    return url.protocol === "http:" || url.protocol === "https:" ? url : undefined
  } catch {
    return undefined
  }
}

/** Only these are ever handed to the system opener. */
export const openable = (url: string | undefined): boolean => httpUrl(url) !== undefined

/** The system a link belongs to — `GitHub`, `Jira`, or its bare domain. Nothing for no link. */
export function systemOf(link: string | undefined, table: readonly System[] = SYSTEMS): string | undefined {
  const url = httpUrl(link)
  if (!url) return undefined
  const host = url.hostname.toLowerCase()
  for (const row of table) {
    const hit = row.host.startsWith(".") ? host.endsWith(row.host) : host === row.host
    if (hit && (row.path === undefined || url.pathname.startsWith(row.path))) return row.name
  }
  return bare(host)
}

/* ─── secrets ────────────────────────────────────────────────────────────────────────────────── */

/**
 * Query parameter names that carry a credential or a signature. Matched whole and case-blind;
 * `X-Amz-*` / `X-Goog-*` (signed cloud links) by prefix. Some are short and ordinary-looking (`sig`,
 * `key`, `code`) — a link that loses one still names the thing, and one that keeps it can leak it.
 */
const SECRET_NAMES = new Set([
  "token",
  "access_token",
  "accesstoken",
  "id_token",
  "refresh_token",
  "auth",
  "auth_token",
  "authorization",
  "jwt",
  "sig",
  "signature",
  "key",
  "api_key",
  "apikey",
  "secret",
  "client_secret",
  "password",
  "passwd",
  "pwd",
  "code",
  "credential",
  "credentials",
  "session",
  "sessionid",
  "private_token",
  "key-pair-id",
  "policy",
])
const SECRET_PREFIXES = ["x-amz-", "x-goog-"]
/** `..._token`, `...Secret`, `...-signature`: a name built on one of the words. */
const SECRET_PARTS = /(?:^|[_-])(token|secret|signature|password)$|(?:Token|Secret|Signature|Password)$/

export function secretParam(name: string): boolean {
  const lower = name.toLowerCase()
  return (
    SECRET_NAMES.has(lower) ||
    SECRET_PREFIXES.some((prefix) => lower.startsWith(prefix)) ||
    SECRET_PARTS.test(name)
  )
}

export interface Cleaned {
  url: string
  /** The query parameters taken out, by name, so the tool can say so. */
  stripped: string[]
}

/** The link as it is safe to store: no credentials, no secret-looking query parameters. */
export function cleanUrl(url: URL): Cleaned {
  const out = new URL(url.href)
  const stripped: string[] = []
  if (out.username || out.password) {
    stripped.push("credentials")
    out.username = ""
    out.password = ""
  }
  for (const name of [...new Set(out.searchParams.keys())])
    if (secretParam(name)) {
      stripped.push(name)
      out.searchParams.delete(name)
    }
  return { url: out.href, stripped }
}

/* ─── work items: PRs and issues ─────────────────────────────────────────────────────────────── */

export interface Work {
  /** The thing's own address, nothing after it: `https://github.com/o/r/pull/33`. */
  url: string
  /** The name people search for: `o/r#33`, `group/project!12`, `COM-1736`, `ENG-42`. */
  ref: string
  /** How a row names it: `PR #33`, `issue #12`, `MR !12`, `COM-1736`. */
  label: string
}

/** Characters a URL in prose is commonly followed by and never ends with. */
const TRAILING = /[).,;:!?'"\]>}]+$/

/**
 * A PR, merge request or issue, read from its link: GitHub pull and issues, GitLab merge requests and
 * issues (any host — GitLab is self-hosted as often as not), Jira's `/browse/KEY-1`, Linear's
 * `/team/issue/KEY-1`. Anything else is not a work item.
 */
export function workOf(link: string | undefined): Work | undefined {
  const url = httpUrl(link?.replace(TRAILING, ""))
  if (!url) return undefined
  const host = url.hostname.toLowerCase()
  const origin = `${url.protocol}//${url.host}`
  const parts = url.pathname.split("/").filter(Boolean)
  if (host === "github.com" && parts.length >= 4) {
    const [owner, repo, what, number] = parts as [string, string, string, string]
    if ((what === "pull" || what === "issues") && /^\d+$/.test(number))
      return {
        url: `${origin}/${owner}/${repo}/${what}/${number}`,
        ref: `${owner}/${repo}#${number}`,
        label: what === "pull" ? `PR #${number}` : `issue #${number}`,
      }
  }
  const dash = parts.indexOf("-")
  if (dash > 0 && parts.length >= dash + 3) {
    const what = parts[dash + 1]
    const number = parts[dash + 2] as string
    if ((what === "merge_requests" || what === "issues") && /^\d+$/.test(number)) {
      const project = parts.slice(0, dash).join("/")
      const mark = what === "merge_requests" ? "!" : "#"
      return {
        url: `${origin}/${project}/-/${what}/${number}`,
        ref: `${project}${mark}${number}`,
        label: what === "merge_requests" ? `MR !${number}` : `issue #${number}`,
      }
    }
  }
  if (
    host.endsWith(".atlassian.net") &&
    parts[0] === "browse" &&
    parts[1] &&
    /^[A-Z][A-Z0-9_]*-\d+$/.test(parts[1])
  )
    return { url: `${origin}/browse/${parts[1]}`, ref: parts[1], label: parts[1] }
  if (host === "linear.app" && parts[1] === "issue" && parts[2] && /^[A-Z][A-Z0-9]*-\d+$/i.test(parts[2])) {
    const key = parts[2].toUpperCase()
    return { url: `${origin}/${parts[0]}/issue/${parts[2]}`, ref: key, label: key }
  }
  return undefined
}

/**
 * What two links are compared by: a work item by its own address (so `/pull/33/files` and
 * `/pull/33#discussion` are the PR), anything else by host and path, case-blind on the host, without
 * a trailing slash or a fragment. The query stays — it can be what tells two pages apart.
 */
export function linkKey(link: string): string {
  const work = workOf(link)
  if (work) return work.url.toLowerCase()
  const url = httpUrl(link)
  if (!url) return link.trim()
  const path = url.pathname.replace(/\/+$/, "")
  return `${url.protocol}//${url.host.toLowerCase()}${path}${url.search}`
}

/** Every `http(s)` link in some text, in order, once each. */
export function linksIn(text: string): string[] {
  const out: string[] = []
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`]+/g)) {
    const link = match[0].replace(TRAILING, "")
    if (!out.includes(link)) out.push(link)
  }
  return out
}

/** The PRs and issues in some text — a command's output — by their own address, once each. */
export function workIn(text: string): Work[] {
  const out: Work[] = []
  for (const link of linksIn(text)) {
    const work = workOf(link)
    if (work && !out.some((each) => each.url === work.url)) out.push(work)
  }
  return out
}
