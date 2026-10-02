import type { LogLine, ShellInfo } from "@opencode-cockpit/protocol/shell"
import { describeStatus, formatLines } from "./format.ts"

/**
 * Who hears about a shell, and what they are told.
 *
 * A shell is *shown* in the conversation (`owner.session`, the root) but was *asked for* by whoever
 * called shell_start (`owner.origin`) — a subagent, sometimes. Notices belong to the one that asked:
 * waking the main agent for a subagent's watcher is noise, and the subagent that is waiting on it
 * never hears. A subagent that has already answered is different again: messaging it wakes it, it
 * does the work, and the main agent is never told (measured, docs/opencode/agents.md). So a failure
 * goes up to the conversation, which can hand it back to that subagent; a clean result stays quiet.
 *
 * A failure told to a subagent mid-run is not the end of it either. In the 0.8 load test the "Flaky
 * shell" subagent was told its shell crashed, answered "the failure is expected, nothing to fix", and
 * the main agent — which owned the task — only found the crash in shell_list. So the conversation is
 * also told, once, when that subagent's run ends: which of its shells failed, and that it was told.
 * Not at the moment of failure (the subagent is the one placed to act, and the main agent is usually
 * waiting on it), and not about clean results — the least that still means a failed shell a subagent
 * started cannot pass the main agent by. `relayed` and `relayText` below.
 *
 * On OpenCode 1 nothing is told to a running subagent at all: a failure is only held for that relay,
 * a clean result dropped (the subagent can wait on its shell with shell_wait). A message there is
 * picked up at the run's next step; when there is none — the subagent is writing its answer — it
 * starts another turn after that answer, and the `task` tool hands the main agent the subagent's
 * *last* message: measured, the reply to a notice became the task's answer and the real one was
 * lost. When it lands cannot be told from outside, so it is never sent. OpenCode 2 steers it into
 * the running turn, and the answer stays the subagent's own.
 *
 * Pure, so the decision is tested without a daemon or an OpenCode.
 */

/** Whether the news is worth bothering someone about who is no longer waiting for it. */
export type Outcome = "failure" | "clean"

export type Route =
  /** Deliver as is. `steer` when the session is mid-turn, so the message joins that turn. */
  | { kind: "deliver"; session: string; steer: boolean }
  /** The subagent that asked has finished: tell the conversation, naming the subagent. */
  | { kind: "parent"; session: string; subagent: string }
  /**
   * The subagent that asked is running, on OpenCode 1: tell it nothing — the message could become
   * its answer — and tell the conversation (`session`) when it finishes.
   */
  | { kind: "hold"; session: string; subagent: string }
  | { kind: "drop"; reason: string }

export interface RouteInput {
  owner: ShellInfo["owner"]
  outcome: Outcome
  /**
   * Whether the origin session is working on a turn right now; undefined when the host cannot say.
   * Unknown is read as finished: a failure then reaches the conversation, which can always act on
   * it, instead of waking a subagent nobody is listening to.
   */
  originBusy: boolean | undefined
  /** Which OpenCode: 1 cannot steer a message into a running turn. Unset is read as 2. */
  version?: 1 | 2
}

export function routeNotice({ owner, outcome, originBusy, version }: RouteInput): Route {
  const root = owner.session
  if (!root) return { kind: "drop", reason: "started by the user" }
  const origin = owner.origin
  // No origin (an older plugin or daemon), or the conversation itself asked: as it always was.
  if (!origin || origin === root) return { kind: "deliver", session: root, steer: false }
  /** OpenCode 1 messages a running subagent with nothing, good news or bad: either could become its answer. */
  if (originBusy === true && version === 1)
    return outcome === "failure"
      ? { kind: "hold", session: root, subagent: origin }
      : { kind: "drop", reason: "OpenCode 1: a message to a running subagent can replace its answer" }
  if (originBusy === true) return { kind: "deliver", session: origin, steer: true }
  if (outcome === "failure") return { kind: "parent", session: root, subagent: origin }
  return { kind: "drop", reason: "the subagent that started it has finished, and nothing failed" }
}

/** How a shell's run ended, for routing: anything but a clean exit 0 is a failure. */
export function exitOutcome(info: ShellInfo): Outcome {
  const failed =
    info.status === "failed" || info.status === "killed" || (info.status === "exited" && info.exitCode !== 0)
  return failed ? "failure" : "clean"
}

/** A watcher's change: only `fail` is bad news. `unknown` is a run that matched neither pattern. */
export function healthOutcome(current: string): Outcome {
  return current === "fail" ? "failure" : "clean"
}

export interface Subagent {
  session: string
  /** The agent it ran as, e.g. `general`; unknown when the host never said. */
  agent?: string
  title?: string
}

/**
 * Told to the conversation when a finished subagent's shell failed: who that subagent was, and how
 * to hand the failure back to it, which keeps its context — better than the main agent redoing the
 * work. The tool differs by OpenCode: v1 continues a subagent with `task` and `task_id`, v2 with
 * `subagent` and the child's `sessionID`.
 */
export function subagentNote(sub: Subagent, version: 1 | 2): string {
  const who = [sub.agent ? `the ${sub.agent} subagent` : "a subagent", sub.title ? `"${sub.title}"` : ""]
    .filter(Boolean)
    .join(" ")
  const how =
    version === 1
      ? `call the task tool with task_id "${sub.session}"`
      : `call the subagent tool with sessionID "${sub.session}"`
  return [
    `This shell was started by ${who} (session ${sub.session}), which has already finished, so it was not told.`,
    `If the failure matters, continue that subagent with the error rather than redoing its work: ${how} and a prompt that includes the output above.`,
  ].join("\n")
}

/**
 * Whether a notice the conversation did not get must reach it when the subagent's run ends: a failure
 * handed to a subagent that is not the conversation, or held from one (OpenCode 1). A clean result
 * never is.
 */
export function relayed(route: Route, owner: ShellInfo["owner"], outcome: Outcome): boolean {
  if (outcome !== "failure" || !owner.session) return false
  if (route.kind === "hold") return true
  return route.kind === "deliver" && route.session !== owner.session
}

/** One shell that failed while a subagent worked, as the conversation is told of it. */
export interface Relayed {
  id: string
  title: string
  /** How it failed: `crashed with exit code 1 after 5s`, `fail: 2 errors`. */
  status: string
}

/**
 * Told to the conversation when a subagent whose shells failed while it worked finishes: which ones,
 * whether it was told (OpenCode 2 tells it; OpenCode 1 holds it back, `routeNotice` says why), and
 * how to hand them to it.
 */
export function relayText(sub: Subagent, shells: readonly Relayed[], version: 1 | 2): string {
  const who = [sub.agent ? `the ${sub.agent} subagent` : "a subagent", sub.title ? `"${sub.title}"` : ""]
    .filter(Boolean)
    .join(" ")
  const how =
    version === 1
      ? `call the task tool with task_id "${sub.session}"`
      : `call the subagent tool with sessionID "${sub.session}"`
  const many = shells.length > 1
  return [
    `<subagent_shells_failed session="${sub.session}">`,
    `${many ? `${shells.length} shells` : "A shell"} started by ${who} (session ${sub.session}) failed while it worked:`,
    ...shells.map((shell) => `- ${shell.id} "${shell.title}": ${shell.status}`),
    "</subagent_shells_failed>",
    version === 1
      ? `It was not told — on this OpenCode a message to a running subagent can replace its answer — and has now finished. If ${many ? "they matter" : "it matters"} and its answer does not account for ${many ? "them" : "it"}, continue that subagent with the error rather than redoing its work: ${how}. shell_read id=${shells[0]?.id ?? "<id>"} shows the output.`
      : `It was told at the time, and has now finished. Check its answer dealt with ${many ? "them" : "it"}; if not and it matters, continue that subagent with the error rather than redoing its work: ${how}. shell_read id=${shells[0]?.id ?? "<id>"} shows the output.`,
  ].join("\n")
}

/**
 * Whether an OpenCode event says a session started or stopped working, read from either version's
 * shape: v1's `{ type, properties }`, v2's `{ type, data }`. OpenCode 2's agent side has no status
 * call, so following these is how Shell knows a subagent is still running there.
 */
export function activityOf(event: unknown): { session: string; busy: boolean } | undefined {
  if (!event || typeof event !== "object") return undefined
  const { type, properties, data } = event as { type?: unknown; properties?: unknown; data?: unknown }
  const body = (data ?? properties) as { sessionID?: unknown; status?: { type?: unknown } } | undefined
  const session = body?.sessionID
  if (typeof type !== "string" || typeof session !== "string" || !session) return undefined
  switch (type) {
    case "session.execution.started":
      return { session, busy: true }
    case "session.execution.succeeded":
    case "session.execution.failed":
    case "session.execution.interrupted":
    case "session.idle":
      return { session, busy: false }
    case "session.status": {
      const status = body?.status?.type
      return typeof status === "string" ? { session, busy: status !== "idle" } : undefined
    }
    default:
      return undefined
  }
}

/** `<shell_exited>`: how it ended, the last of its output, and where to look next. */
export function exitText(info: ShellInfo, tail: LogLine[]): string {
  return [
    `<shell_exited id="${info.id}" title="${info.title}">`,
    describeStatus(info),
    tail.length > 0 ? `last output:\n${formatLines(tail)}` : "(no output)",
    "</shell_exited>",
    exitOutcome(info) === "failure"
      ? `Investigate with shell_read id=${info.id} grep="error|fail" if the failure matters to the task.`
      : `Full output: shell_read id=${info.id}.`,
  ].join("\n")
}

/** `<shell_health>`: one message per change of a watcher's status, never per line. */
export function healthText(
  info: ShellInfo,
  change: { previous: string; current: string; summary?: string },
): string {
  return [
    `<shell_health id="${info.id}" title="${info.title}" status="${change.current}">`,
    `${info.watch?.preset ?? "watch"}: ${change.previous} → ${change.current}`,
    change.summary ?? "",
    "</shell_health>",
    change.current === "ok"
      ? "Previously reported problems in this shell are resolved."
      : `Investigate with shell_read id=${info.id} if this affects your current task.`,
  ]
    .filter(Boolean)
    .join("\n")
}
