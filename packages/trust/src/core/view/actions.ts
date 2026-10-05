/**
 * What `x`, `w` and `c` do, on whatever is selected — a command, a family, an answer in the feed, or
 * OpenCode's own "always". Pure: each returns the events to append and the sentence to say. Nothing
 * in the ledger is ever changed in place.
 */

import { anyOf, readSubject, showSubject, widenable } from "../family.ts"
import type { Answer } from "../history.ts"
import type { Event } from "../ledger.ts"
import { type AlwaysGroup, type Command, type Family, leadOf, type Reading, stale } from "./model.ts"
import { agentsText, plural } from "./parts.ts"
import type { Tone } from "./rows.ts"

export type Target =
  | { kind: "command"; command: Command; family?: Family }
  | { kind: "family"; family: Family }
  | { kind: "answer"; answer: Answer }
  | { kind: "always"; groups: AlwaysGroup[] }

export interface Outcome {
  /** To append to the ledger. */
  events: Event[]
  notice: { text: string; tone: Tone }
}

/** What a widening never covers, in words — the three `family.outside` holds back. */
export const EXCEPT = "except dangerous ones, ones that write a file and ones that run another program"
export const NOT_COVERED = "dangerous ones, and any that write a file or run another program"

const revoked = (permission: string, agent: string, subject: string): Event => ({
  v: 1,
  at: 0,
  type: "revoked",
  permission,
  agent,
  subject,
})
const stamp = (events: Event[], at: number): Event[] => events.map((event) => ({ ...event, at }))

/* ─── x ──────────────────────────────────────────────────────────────────────────────────────── */

/** What `x` is called on a target: revoke what answers, forget what is only counting. */
export function revokeLabel(target: Target): { label: string; off: boolean } {
  if (target.kind === "always") return { label: "Revoke", off: true }
  if (target.kind === "answer") return { label: "Revoke", off: false }
  if (target.kind === "family") {
    if (stale(target.family)) return { label: "Remove", off: false }
    const answering =
      target.family.widened.length > 0 || target.family.commands.some((c) => c.phase === "answering")
    return { label: answering ? "Revoke all" : "Forget all", off: false }
  }
  return { label: target.command.phase === "answering" ? "Revoke" : "Forget", off: false }
}

/**
 * `x`. A command loses its standing for every agent. A family loses every command in it and its
 * widenings. An answer in the feed stops what gave it: the rule's own count, or the widening.
 * OpenCode's own "always" is OpenCode's: Trust cannot take it back, and says so.
 */
export function revoke(target: Target, reading: Reading, at: number): Outcome {
  const { threshold } = reading.settings
  if (target.kind === "always")
    return {
      events: [],
      notice: {
        text: 'OpenCode keeps its own "always" until it restarts — Trust cannot take it back.',
        tone: "warning",
      },
    }
  if (target.kind === "answer") {
    const { answer } = target
    const events: Event[] = []
    const widened = new Set<string>()
    for (const item of answer.items) {
      if (item.via !== undefined) {
        if (widened.has(item.via)) continue
        widened.add(item.via)
        events.push({
          v: 1,
          at,
          type: "unwidened",
          permission: answer.permission,
          agent: answer.agent,
          family: item.via,
        })
      } else events.push(revoked(answer.permission, answer.agent, item.subject))
    }
    const name = answer.items.map((item) => showSubject(answer.permission, item.subject)).join(" && ")
    return {
      events: stamp(events, at),
      notice: {
        text:
          widened.size > 0
            ? `Stopped: ${[...widened].map((family) => anyOf(answer.permission, family)).join(", ")} no longer answered for ${answer.agent}.`
            : `Revoked: ${name} is asked again until you approve it ${threshold}× more, as ${answer.agent}.`,
        tone: "muted",
      },
    }
  }
  if (target.kind === "command") {
    const { command } = target
    const name = showSubject(command.permission, command.subject)
    const agents = command.standings.map((each) => each.entry.agent)
    const via = command.standings.find((each) => each.stand.kind === "widened")
    const events = command.standings.map((each) =>
      revoked(each.entry.permission, each.entry.agent, each.entry.subject),
    )
    const others = agents.length > 1 ? ` — for ${agentsText(agents)}` : ""
    return {
      events: stamp(events, at),
      notice: {
        text:
          via?.stand.kind === "widened"
            ? `Forgot ${name}'s own count${others}; ${anyOf(command.permission, via.stand.family)} still answers it — [w] undoes that.`
            : command.phase === "answering"
              ? `Revoked: ${name} is asked again until you approve it ${threshold}× more${others}.`
              : `Forgot the count for ${name}${others}: it starts again from 0.`,
        tone: "muted",
      },
    }
  }
  const { family } = target
  const events: Event[] = [
    ...family.commands.flatMap((command) =>
      command.standings.map((each) => revoked(each.entry.permission, each.entry.agent, each.entry.subject)),
    ),
    ...family.widened.map(
      (each): Event => ({
        v: 1,
        at,
        type: "unwidened",
        permission: each.permission,
        agent: each.agent,
        family: each.family,
      }),
    ),
  ]
  const name = showSubject(family.permission, family.family)
  const answering = family.commands.filter((command) => command.phase === "answering").length
  return {
    events: stamp(events, at),
    notice: {
      text: stale(family)
        ? `Removed the old widening: ${anyOf(family.permission, family.family)} is gone.`
        : answering > 0 || family.widened.length > 0
          ? `Revoked ${plural(family.commands.length, "command")} in ${name}${
              family.widened.length > 0 ? ", and its widening" : ""
            } — each is asked again until approved ${threshold}× in a row.`
          : `Forgot ${plural(family.commands.length, "count")} in ${name}: each starts again from 0.`,
      tone: "muted",
    },
  }
}

/* ─── w ──────────────────────────────────────────────────────────────────────────────────────── */

/** The family `w` acts on, and for which agent. */
export interface WidenScope {
  permission: string
  family: string
  /** The agent `w` would widen it for. */
  agent?: string
  /** Agents it is widened for now, of those `w` would act on: non-empty means `w` undoes. */
  undo: string[]
}

export function widenScope(target: Target, families: readonly Family[]): WidenScope | undefined {
  if (target.kind === "always") return undefined
  const find = (permission: string, family: string) =>
    families.find((each) => each.permission === permission && each.family === family)
  if (target.kind === "family") {
    const { family } = target
    return {
      permission: family.permission,
      family: family.family,
      ...(family.commands[0] ? { agent: leadOf(family.commands[0]).entry.agent } : {}),
      undo: family.widened.map((each) => each.agent),
    }
  }
  const [permission, familyName, agent] =
    target.kind === "answer"
      ? [
          target.answer.permission,
          target.answer.items.find((item) => item.via !== undefined)?.via ??
            familyOfAnswer(target.answer, families),
          target.answer.agent,
        ]
      : [target.command.permission, target.command.family, leadOf(target.command).entry.agent]
  if (familyName === undefined) return undefined
  const widened = find(permission, familyName)?.widened ?? []
  return {
    permission,
    family: familyName,
    agent,
    undo: widened.filter((each) => each.agent === agent).map((each) => each.agent),
  }
}

/** The family of an answer's first command, as the model grouped it. */
function familyOfAnswer(answer: Answer, families: readonly Family[]): string | undefined {
  const first = answer.items[0]?.subject
  if (first === undefined) return undefined
  return families.find((family) =>
    family.commands.some((command) => command.permission === answer.permission && command.subject === first),
  )?.family
}

/** The family's name in a button: commands stay lowercase, where it runs is left to the card. */
export function familyLabel(permission: string, family: string): string {
  const text = permission === "bash" ? showSubject("bash", family).replace(/^\(in .*?\) /, "") : family
  return text.length > 20 ? `${text.slice(0, 19)}…` : text
}

/** What `w` is called: `Trust any head`, `Undo any head`, or dimmed when the family never widens. */
export function widenLabel(scope: WidenScope | undefined, named = true): { label: string; off: boolean } {
  if (!scope) return { label: "Trust any", off: true }
  const name = named ? ` ${familyLabel(scope.permission, scope.family)}` : ""
  if (scope.undo.length > 0) return { label: `Undo any${name}`, off: false }
  return { label: `Trust any${name}`, off: !widenable(scope.permission, scope.family).ok }
}

/**
 * `w`: trust a whole family for one agent, or take that back. Never automatic — this is the only place
 * a `widened` event is made, and only a person reaches it. A dangerous family is refused, with why.
 */
export function widen(scope: WidenScope | undefined, families: readonly Family[], at: number): Outcome {
  if (!scope)
    return {
      events: [],
      notice: { text: "OpenCode's own approvals have no family to widen.", tone: "warning" },
    }
  const any = anyOf(scope.permission, scope.family)
  if (scope.undo.length > 0)
    return {
      events: scope.undo.map((agent) => ({
        v: 1,
        at,
        type: "unwidened",
        permission: scope.permission,
        agent,
        family: scope.family,
      })),
      notice: {
        text: `Back to exact rules: ${any} is no longer answered for ${agentsText(scope.undo)}.`,
        tone: "muted",
      },
    }
  const can = widenable(scope.permission, scope.family)
  if (!can.ok) return { events: [], notice: { text: `Not widened: ${can.why}.`, tone: "warning" } }
  if (scope.agent === undefined)
    return { events: [], notice: { text: "No agent to widen it for.", tone: "warning" } }
  const family = families.find((each) => each.permission === scope.permission && each.family === scope.family)
  const others = [
    ...new Set(
      (family?.commands ?? []).flatMap((command) =>
        command.standings.map((each) => each.entry.agent).filter((agent) => agent !== scope.agent),
      ),
    ),
  ]
  return {
    events: [
      { v: 1, at, type: "widened", permission: scope.permission, agent: scope.agent, family: scope.family },
    ],
    notice: {
      text: `Trusted ${any} for ${scope.agent}${scope.permission === "bash" ? ` — ${EXCEPT} still ask` : ""}.${
        others.length > 0 ? ` ${agentsText(others)} keep${others.length === 1 ? "s" : ""} counting.` : ""
      } [w] again undoes it.`,
      tone: "success",
    },
  }
}

/* ─── c ──────────────────────────────────────────────────────────────────────────────────────── */

/**
 * The target as `opencode.json` would say it, for you to paste — Trust never writes OpenCode's
 * config. A family is a wildcard (`"ls *": "allow"`), and config says less than a widening: not which
 * agent, and not the commands a widening still asks about.
 */
export function configSnippet(target: Target): { text: string; note?: string } {
  if (target.kind === "always") {
    const permission: Record<string, Record<string, string>> = {}
    for (const group of target.groups)
      for (const pattern of group.patterns) {
        const rules = permission[group.permission] ?? {}
        rules[pattern] = "allow"
        permission[group.permission] = rules
      }
    return { text: JSON.stringify({ permission }) }
  }
  if (target.kind === "family") return familySnippet(target.family)
  const [permission, subject] =
    target.kind === "answer"
      ? [target.answer.permission, target.answer.items[0]?.subject ?? ""]
      : [target.command.permission, target.command.subject]
  const placed = subject.match(/^\(in [^)]*\) (.*)$/s)
  const pattern =
    permission === "webfetch" ? `https://${subject}/*` : placed ? (placed[1] as string) : subject
  const text = JSON.stringify({ permission: { [permission]: { [pattern]: "allow" } } })
  return placed
    ? { text, note: "a config rule cannot say where a command runs: this one allows it anywhere" }
    : { text }
}

function familySnippet(family: Family): { text: string; note?: string } {
  const notes: string[] = []
  let pattern = family.family
  if (family.permission === "bash") {
    const read = readSubject(family.family)
    if (read) {
      const env = read.command.env.map((word) => word.replace(/=…$/, "=*"))
      pattern = `${[...env, ...read.command.argv].join(" ")} *`
      if (read.place !== undefined) notes.push("anywhere, not only where it ran")
    }
  } else if (family.permission === "edit") {
    pattern = `${family.family === "./" ? "" : family.family}*`
    notes.push("its * reaches into subfolders too")
  } else if (family.permission === "webfetch") pattern = `https://${family.family}/*`
  const any = anyOf(family.permission, family.family)
  notes.unshift(
    family.widened.length > 0
      ? `config cannot say which agent, so it allows ${any} for every one — even the ones Trust still asks about`
      : `wider than anything Trust answers here: ${any}, for every agent`,
  )
  return {
    text: JSON.stringify({ permission: { [family.permission]: { [pattern]: "allow" } } }),
    note: notes.join("; "),
  }
}
