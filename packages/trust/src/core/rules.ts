/**
 * What `opencode.json` says about a permission, read the way OpenCode reads it.
 *
 * Trust only ever sees the gap config left open (docs/opencode/permissions.md): `deny` never emits an
 * event and `allow` never needs one. Inside that gap there are two kinds of "ask", and telling them
 * apart is this file's job:
 *
 * - **a catch-all** — `"bash": "ask"`, `{ "bash": { "*": "ask" } }`, or no rule at all — is a default:
 *   "I have not decided about these". Trust may fill it.
 * - **a specific pattern set to ask** — `"git push *": "ask"` — is a decision: "always ask me about
 *   this one". Trust never answers it.
 *
 * Matching is OpenCode's own: its wildcard (`*` any run, `?` one character, and a trailing ` *` that
 * also matches nothing, so `ls *` covers `ls`), evaluated over the ordered rules, last match wins.
 * The merge across files is OpenCode's too — v1 hands over the merged config; v2 hands over its
 * documents in priority order, and concatenating their rules in that order keeps "last match wins"
 * meaning what it meant.
 */

export type Action = "allow" | "deny" | "ask"

export interface ConfigRule {
  /** Permission name, canonical (`bash`, never `shell`); may be a wildcard such as `*`. */
  permission: string
  pattern: string
  action: Action
}

/**
 * One name per permission, whichever OpenCode asked. v2 renamed several (measured in 2.0.18's own
 * table: `bash → shell`, `task → subagent`, `write`/`patch → edit`); a rule written for one must
 * still match a request from the other.
 */
const CANONICAL: Record<string, string> = {
  shell: "bash",
  subagent: "task",
  write: "edit",
  patch: "edit",
  apply_patch: "edit",
  multiedit: "edit",
}

export const canonical = (permission: string): string => CANONICAL[permission] ?? permission

/** OpenCode's `Wildcard.match`, as in `util/wildcard.ts`. */
export function match(text: string, pattern: string): boolean {
  const subject = text.replaceAll("\\", "/")
  let escaped = pattern
    .replaceAll("\\", "/")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")
  // "ls *" covers both "ls" and "ls -la".
  if (escaped.endsWith(" .*")) escaped = `${escaped.slice(0, -3)}( .*)?`
  return new RegExp(`^${escaped}$`, "s").test(subject)
}

const ACTIONS = new Set(["allow", "deny", "ask"])
const isAction = (value: unknown): value is Action => typeof value === "string" && ACTIONS.has(value)
type Json = Record<string, unknown>
const obj = (value: unknown): Json | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : undefined

/**
 * OpenCode 1's `permission` block: `"ask"` for everything, `{ bash: "ask" }` for one permission, or
 * `{ bash: { "git push *": "ask" } }` for patterns. Key order is rule order.
 */
function fromV1(permission: unknown): ConfigRule[] {
  if (isAction(permission)) return [{ permission: "*", pattern: "*", action: permission }]
  const block = obj(permission)
  if (!block) return []
  const rules: ConfigRule[] = []
  for (const [name, value] of Object.entries(block)) {
    if (isAction(value)) rules.push({ permission: canonical(name), pattern: "*", action: value })
    else
      for (const [pattern, action] of Object.entries(obj(value) ?? {}))
        if (isAction(action)) rules.push({ permission: canonical(name), pattern, action })
  }
  return rules
}

/** OpenCode 2's `permissions`: an ordered list of `{ action, resource, effect }`. */
function fromV2(permissions: unknown): ConfigRule[] {
  if (!Array.isArray(permissions)) return []
  return permissions.flatMap((entry) => {
    const rule = obj(entry)
    if (
      !rule ||
      typeof rule.action !== "string" ||
      typeof rule.resource !== "string" ||
      !isAction(rule.effect)
    )
      return []
    return [{ permission: canonical(rule.action), pattern: rule.resource, action: rule.effect }]
  })
}

/** Every rule one config document holds at its top level, in order. */
function own(config: Json): ConfigRule[] {
  return [...fromV1(config.permission), ...fromV2(config.permissions)]
}

/** The rules an agent adds on top: v1 `agent.<name>.permission` (and the older `mode`), v2 `agents`. */
function agentRules(config: Json, agent: string | undefined): ConfigRule[] {
  if (!agent) return []
  const rules: ConfigRule[] = []
  for (const key of ["mode", "agent", "agents"]) {
    const entry = obj(obj(config[key])?.[agent])
    if (entry) rules.push(...own(entry))
  }
  return rules
}

/**
 * The rules in force for an agent, from whatever `config.get` returned: v1's merged config, or v2's
 * list of documents (`{ type: "document", info }`, lowest priority first). The agent's rules come last
 * because OpenCode lays them over the global ones.
 */
export function rulesFrom(config: unknown, agent?: string): ConfigRule[] {
  const documents = Array.isArray(config)
    ? config.flatMap((entry) => {
        const info = obj(obj(entry)?.info)
        return info ? [info] : []
      })
    : obj(config)
      ? [obj(config) as Json]
      : []
  return [...documents.flatMap(own), ...documents.flatMap((document) => agentRules(document, agent))]
}

/** The rule that decides `text` for `permission`, as OpenCode picks it: the last that matches. */
export function evaluate(
  rules: readonly ConfigRule[],
  permission: string,
  text: string,
): ConfigRule | undefined {
  const name = canonical(permission)
  return rules.findLast((rule) => match(name, rule.permission) && match(text, rule.pattern))
}

/**
 * What config means for one pattern of a request.
 *
 * `open` — nothing decided it, or a catch-all said ask: Trust's to fill.
 * `allowed` — config allows it; the request asked because of something else in it.
 * `held` — you asked to be asked (a specific `ask`), or config denies it: Trust stays out.
 */
export type Gate =
  | { kind: "open" }
  | { kind: "allowed"; rule: ConfigRule }
  | { kind: "held"; rule: ConfigRule }

export function gate(rules: readonly ConfigRule[], permission: string, text: string): Gate {
  const rule = evaluate(rules, permission, text)
  if (!rule) return { kind: "open" }
  if (rule.action === "allow") return { kind: "allowed", rule }
  if (rule.action === "ask" && rule.pattern === "*") return { kind: "open" }
  return { kind: "held", rule }
}

/** A rule as you would have written it, for a reason shown to you. */
export function describeRule(rule: ConfigRule): string {
  return rule.pattern === "*"
    ? `"${rule.permission}": "${rule.action}"`
    : `"${rule.pattern}": "${rule.action}"`
}
