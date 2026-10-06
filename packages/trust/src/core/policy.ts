/**
 * Whether Trust answers a request, and why — a pure function of the request, what config says, and
 * what the ledger adds up to.
 *
 * The order of the questions is the design:
 *
 * 1. **Can it be read?** A command line with `$(…)` in it, a permission that exists to make a person
 *    look (`external_directory`, `doom_loop`): asked, and nothing is counted.
 * 2. **Did you ask to be asked?** A specific `ask` rule in config matching any part of the request
 *    holds all of it. So does a `deny`, though OpenCode never lets one reach us.
 * 3. **Is every part trusted, or allowed by config?** One untrusted command in a line is enough to
 *    ask: `git status && rm -rf build` is not half-approved. A part is trusted by its own count, or
 *    by a family you widened for this agent — unless it is one a widening never covers (dangerous,
 *    writing a file, by redirection or by flag, running another program: `family.outside`) — or by a
 *    family of reads Trust learned for this agent, which covers plain reads only (effect.ts). Config's
 *    `ask` was settled in 2, so it still wins over both.
 *
 * The answer always carries what an approval of the request would count towards, so a person's
 * approval of a request Trust declined is counted against exactly what Trust looked at.
 */

import { anyOf, familyOf, notReadSubject, outside } from "./family.ts"
import { type Context, type Request, subjectsOf } from "./keys.ts"
import { type Item, keyOf, live, type State, standing, type Thresholds } from "./ledger.ts"
import { type ConfigRule, describeRule, gate } from "./rules.ts"

export interface Progress {
  subject: string
  danger?: string
  have: number
  need: number
  trusted: boolean
  /** Trusted through this widened family rather than by its own count. */
  via?: string
  /** The family in `via` is one Trust learned from your approvals of reads in it. */
  learned?: true
}

export interface Judgement {
  /** Trust approves it now. */
  answer: boolean
  /** In words: logged with every answer, shown beside a request Trust left to you. */
  why: string
  /** What a person's approval of this request counts towards. Empty: nothing is counted. */
  items: Item[]
  /** Where each counted subject stands, for the sidebar's `2/3`. */
  progress: Progress[]
}

export interface DecideInput {
  request: Request
  context: Context
  agent: string
  /** OpenCode's rules for this agent (`rules.rulesFrom`). */
  rules: readonly ConfigRule[]
  state: State
  settings: Thresholds
  now: number
}

const left = (why: string): Judgement => ({ answer: false, why, items: [], progress: [] })

export function decide(input: DecideInput): Judgement {
  const { request, context, rules, state, settings, now } = input
  const keyed = subjectsOf(request, context)
  if (keyed.kind !== "subjects") return left(keyed.why)

  for (const text of [...keyed.subjects.flatMap((subject) => subject.texts), ...keyed.patterns]) {
    const said = gate(rules, request.permission, text)
    if (said.kind === "held")
      return left(
        said.rule.action === "deny"
          ? `config denies it: ${describeRule(said.rule)}`
          : `you asked to be asked: ${describeRule(said.rule)}`,
      )
  }

  const progress: Progress[] = []
  for (const subject of keyed.subjects) {
    /** Allowed by config, all of it: not Trust's to count, and no reason to ask. */
    if (subject.texts.every((text) => gate(rules, request.permission, text).kind === "allowed")) continue
    const found = state.entries.get(keyOf(request.permission, subject.subject))
    const where = standing(found, subject.danger, settings, now)
    const through = where.trusted
      ? undefined
      : widenedFor(state, request.permission, subject.subject, settings, now)
    const via = through?.family
    progress.push({
      subject: subject.subject,
      ...(subject.danger ? { danger: subject.danger } : {}),
      have: where.have,
      need: where.need,
      trusted: where.trusted || via !== undefined,
      ...(via !== undefined ? { via } : {}),
      ...(through?.learned ? { learned: true as const } : {}),
    })
  }
  const items: Item[] = progress.map(({ subject, danger }) => (danger ? { subject, danger } : { subject }))

  /**
   * OpenCode asked, yet by our reading config allows every part: the readings disagree, and when
   * they do the person decides.
   */
  if (progress.length === 0) return left("config allows all of it by our reading — yours to answer")

  const short = progress.filter((each) => !each.trusted)
  if (short.length > 0) {
    const worst = short.reduce((a, b) => (b.need - b.have > a.need - a.have ? b : a))
    return {
      answer: false,
      why:
        progress.length === 1
          ? `${worst.have}/${worst.need} approvals in a row`
          : `${short.length} of ${progress.length} not yet trusted (${worst.subject} ${worst.have}/${worst.need})`,
      items,
      progress,
    }
  }
  if (state.paused) return { answer: false, why: "Trust is paused in this project", items, progress }
  const only = progress[0] as Progress
  /** An answer records which widening gave it, so the ledger can say "any ls" answered `ls -R`. */
  const answered: Item[] = progress.map(({ subject, danger, via, learned }) => ({
    subject,
    ...(danger ? { danger } : {}),
    ...(via !== undefined ? { via } : {}),
    ...(learned ? { learned } : {}),
  }))
  const widened = progress.filter((each) => each.via !== undefined)
  return {
    answer: true,
    why:
      progress.length === 1
        ? only.via !== undefined
          ? only.learned
            ? `a read Trust learned: ${anyOf(request.permission, only.via)}`
            : `in a family you widened: ${anyOf(request.permission, only.via)}`
          : `approved by you ${only.have}× in a row${only.danger ? ` (dangerous: ${only.danger})` : ""}`
        : widened.length > 0
          ? `all ${progress.length} commands trusted (${widened.length} through a family)`
          : `all ${progress.length} commands approved enough times in a row`,
    items: answered,
    progress,
  }
}

/**
 * The family this subject is answered through, for this agent: one you widened covers what a widening
 * covers (`outside`); one Trust learned covers plain reads only (`notReadSubject`).
 */
export function widenedFor(
  state: State,
  permission: string,
  subject: string,
  settings: Thresholds,
  now: number,
): { family: string; learned?: true } | undefined {
  if (state.widened.size === 0) return undefined
  const family = familyOf(permission, subject)
  const found = state.widened.get(keyOf(permission, family))
  if (!found || !live(found, settings, now)) return undefined
  if (found.learned)
    return notReadSubject(permission, subject) === undefined ? { family, learned: true } : undefined
  return outside(permission, subject) === undefined ? { family } : undefined
}
