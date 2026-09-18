import type { WatchRule, WatchState, WatchStatus } from "@opencode-cockpit/protocol/shell"

export interface CompiledRule {
  done?: RegExp
  fail?: RegExp
  ok?: RegExp
  idleMs?: number
}

export function compileRule(rule: WatchRule): CompiledRule {
  const flags = rule.ignoreCase ? "i" : ""
  const compiled: CompiledRule = {}
  if (rule.done) compiled.done = new RegExp(rule.done, flags)
  if (rule.fail) compiled.fail = new RegExp(rule.fail, flags)
  if (rule.ok) compiled.ok = new RegExp(rule.ok, flags)
  if (rule.idleSeconds) compiled.idleMs = Math.round(rule.idleSeconds * 1000)
  return compiled
}

export interface WatchChange {
  previous: WatchStatus
  current: WatchStatus
  summary?: string
}

/**
 * Tracks the health of one shell from its log.
 *
 * A run ends when `done` matches (or, without it, after `idleSeconds` of silence); the run's status
 * is then `fail` if anything matched `fail`, `ok` if anything matched `ok`, and otherwise whatever
 * it was. Only status changes are reported — a watcher that recompiles a thousand times says
 * nothing until something actually breaks or gets fixed. A new failing line during an already
 * failing run is reported too, since it is different news.
 */
export class Watcher {
  private status: WatchStatus = "pending"
  private summaryText: string | undefined
  private runs = 0
  private since = Date.now()
  private sawFail: string | undefined
  private sawOk: string | undefined

  constructor(
    private readonly rule: CompiledRule,
    private readonly preset?: string,
  ) {}

  get idleMs(): number | undefined {
    return this.rule.done ? undefined : this.rule.idleMs
  }

  state(): WatchState {
    const state: WatchState = { status: this.status, runs: this.runs, since: this.since }
    if (this.preset) state.preset = this.preset
    if (this.summaryText) state.summary = this.summaryText
    return state
  }

  /** Feeds one committed log line. Returns a change when the reported status or failure changed. */
  line(text: string, now = Date.now()): WatchChange | undefined {
    if (this.rule.fail?.test(text)) this.sawFail = text.trim()
    else if (this.rule.ok?.test(text)) this.sawOk = text.trim()
    if (!this.rule.done?.test(text)) return undefined
    return this.settle(now)
  }

  /** Ends the current run because output went quiet (rules without a `done` pattern). */
  idle(now = Date.now()): WatchChange | undefined {
    if (this.rule.done) return undefined
    return this.settle(now)
  }

  /** The process ended: a watched program that stops is a failure unless it exited cleanly. */
  exited(
    exitCode: number | undefined,
    signal: string | undefined,
    now = Date.now(),
  ): WatchChange | undefined {
    const clean = exitCode === 0 && !signal
    const summary = clean
      ? this.summaryText
      : `process ended ${signal ? `on ${signal}` : `with exit code ${exitCode ?? "?"}`}`
    return this.apply(
      clean ? (this.sawFail ? "fail" : this.status === "pending" ? "ok" : this.status) : "fail",
      summary,
      now,
    )
  }

  private settle(now: number): WatchChange | undefined {
    if (!this.sawFail && !this.sawOk && this.status === "pending") return undefined
    this.runs++
    const status: WatchStatus = this.sawFail ? "fail" : this.sawOk ? "ok" : this.status
    const summary = this.sawFail ?? this.sawOk ?? this.summaryText
    this.sawFail = undefined
    this.sawOk = undefined
    return this.apply(status === "pending" ? "unknown" : status, summary, now)
  }

  private apply(status: WatchStatus, summary: string | undefined, now: number): WatchChange | undefined {
    const changed = status !== this.status || (status === "fail" && summary !== this.summaryText)
    const previous = this.status
    this.status = status
    this.summaryText = summary
    if (!changed) return undefined
    this.since = now
    return { previous, current: status, summary }
  }
}
