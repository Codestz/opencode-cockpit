import { type ToolContext, type ToolDefinition, tool } from "@opencode-ai/plugin"
import { claimFeature, duplicateFeatureMessage } from "@opencode-cockpit/client"
import { dualServer, type ServerHost, type ServerStart } from "@opencode-cockpit/client/server"
import { createdSession } from "../core/adapt/created.ts"
import { endOf, finishedAt } from "../core/adapt/ends.ts"
import { createV1Translator } from "../core/adapt/v1.ts"
import { createV2Translator } from "../core/adapt/v2.ts"
import type { Change } from "../core/model/changes.ts"
import {
  applyAll,
  emptyModel,
  type Node,
  rootOf,
  type Session,
  subagentsOf,
  working,
} from "../core/model/model.ts"
import { backgroundOffered, subagentsGuidance } from "../core/view/guidance.ts"
import { stateOf, subagentAccount, subagentReport, waitReport } from "../core/view/report.ts"

/**
 * What the agent is told about subagents, once per request (core/view/guidance.ts): written for the
 * tool it actually has — with `background` where the tool offers it, and without a word of it where
 * it does not, since a model told about an option it lacks keeps trying it.
 *
 * Kept as a constant for what imported it: the guidance where background is offered.
 */
export const GUIDANCE = subagentsGuidance({ version: 2, background: true })

const LIST = `List the subagents of this conversation: each one's id, agent, task, state (with when it ended) and last answer.

Use it before following up on work a subagent did, to continue that same subagent by its id instead of starting a new one — it keeps everything it already read and tried.`

const READ = `Read one subagent in full: its state and why it stopped, its task, its whole final answer, and its run — every call with what it was about and how it ended, what it was told, what it said.

Works on finished, failed and cancelled subagents alike: read a cancelled one to see how far it got before continuing it or starting over. Long runs are paged: pass the cursor from "More:" as after.`

const WAIT = `Block until subagents finish, fail, are cancelled, or stop for a permission only the user can answer — or until the timeout. Returns each one's state and answer.

For background subagents, when you have nothing else to do and need their results; a foreground task call already waits. Never sleep or poll instead. With no ids it waits on every subagent of this conversation still working.`

export const SUBAGENTS_PACKAGE = "@opencode-cockpit/subagents"

export interface SubagentsServerOptions {
  source?: string
}

/** How much of each argument the agent side keeps of a call: enough to say what it was about. */
const INPUT_MOST = 300

/**
 * What the agent side keeps of each run: enough to list and recount it — what each call was about
 * and how it ended, not what it printed, nor thinking, so a long session does not hold every file its
 * subagents read.
 */
export function slim(changes: Change[]): Change[] {
  const out: Change[] = []
  for (const change of changes) {
    if (change.type === "thinking") continue
    if (change.type === "tool") {
      const { output: _output, input, ...rest } = change
      const kept = input ? clipInput(input) : undefined
      out.push(kept && Object.keys(kept).length > 0 ? { ...rest, input: kept } : rest)
    } else out.push(change)
  }
  return out
}

function clipInput(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input).slice(0, 8)) {
    if (typeof value === "string")
      out[key] = value.length > INPUT_MOST ? `${value.slice(0, INPUT_MOST)}…` : value
    else if (typeof value === "number" || typeof value === "boolean") out[key] = value
  }
  return out
}

/** A wait never blocks longer than this, whatever it is asked. */
const WAIT_MOST = 1_800

/** The agent side as a factory, so the `opencode-cockpit` bundle can include it. */
export function createSubagentsServer({
  source = SUBAGENTS_PACKAGE,
}: SubagentsServerOptions = {}): ServerStart {
  return async (host, rawOptions) => {
    const claim = claimFeature(host.scope, "subagents", source)
    if (!claim.active) {
      host.log.warn(duplicateFeatureMessage("Subagents", claim.owner, source))
      return {}
    }
    const log = host.log.child("subagents")
    const options = (rawOptions ?? {}) as { guidance?: boolean }
    const background = backgroundOffered(host.version, process.env)
    log.info("background subagents", { offered: background })
    const guidance = subagentsGuidance({ version: host.version, background })
    const runs = createRuns(host)

    const list: ToolDefinition = tool({
      description: LIST,
      args: {},
      async execute(_args, context) {
        const nodes = await runs.nodes(context.sessionID)
        log.debug("list", { sessionID: context.sessionID, count: nodes.length })
        return subagentReport({ nodes, now: Date.now(), version: host.version })
      },
    })

    const z = tool.schema
    const read: ToolDefinition = tool({
      description: READ,
      args: {
        id: z.string().describe("The subagent's id (ses_…), from subagents_list or the task result"),
        after: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Cursor from a previous read\'s "More:" line; lists only what came after it'),
      },
      async execute(args, context) {
        const session = await runs.find(args.id, context.sessionID)
        const children = subagentsOf(runs.model, session.id)
        return subagentAccount({
          session,
          children,
          now: Date.now(),
          version: host.version,
          after: args.after ?? 0,
        })
      },
    })

    const wait: ToolDefinition = tool({
      description: WAIT,
      args: {
        ids: z
          .array(z.string())
          .optional()
          .describe("Subagent ids to wait on; omit for every one of this conversation still working"),
        any: z
          .boolean()
          .default(false)
          .describe("Return as soon as the first of them stops, instead of when all have"),
        timeoutSeconds: z.number().positive().max(WAIT_MOST).default(300),
      },
      async execute(args, context) {
        return runs.wait(args, context)
      },
    })

    return {
      ...(options.guidance === false ? {} : { system: async () => [guidance] }),
      tools: { subagents_list: list, subagents_read: read, subagents_wait: wait },
      event: (event) => {
        try {
          runs.event(event)
        } catch (error) {
          log.warn("event failed", { error })
        }
      },
      sessionDeleted: async (sessionID) => {
        runs.forget(sessionID)
      },
      dispose: () => claim.release(),
    }
  }
}

/**
 * The runs the agent side knows: what the events said, completed from the store for any subagent
 * whose start it did not see — one from before OpenCode restarted, say, continued since. Known only
 * from the events after the restart, such a run listed its newest prompt as its task, counted only
 * its newest calls, and lost its agent and title — the main agent read it as another subagent's work
 * (the load test's "task_id resumed the wrong session").
 */
function createRuns(host: ServerHost) {
  const log = host.log.child("subagents")
  const model = emptyModel()
  const v1 = host.version === 1 ? createV1Translator() : undefined
  const v2 = v1 ? undefined : createV2Translator()
  /** Sessions whose whole run is in the model: created while we listened, or read from the store. */
  const whole = new Set<string>()
  /** Called after every event, for waits. */
  const listeners = new Set<() => void>()

  const event = (raw: unknown) => {
    const created = createdSession(raw)
    if (created) whole.add(created)
    const changes = slim(v1 ? v1.event(raw) : (v2?.event(raw) ?? []))
    if (changes.length > 0) {
      applyAll(model, changes)
      for (const listener of listeners) listener()
    }
  }

  /**
   * Puts a session's stored run in place of what the events gave, keeping where it hangs and whether
   * it was launched in the background. `busy` is the host's word on whether it works now; unknown
   * keeps what the events said.
   */
  const rebuild = (id: string, info: Change[], past: Change[], end: number, busy: boolean | undefined) => {
    const old = model.sessions.get(id)
    const live = busy ?? (old ? working(old) && old.status !== "starting" : false)
    const fresh = applyAll(emptyModel(), [
      ...info,
      ...past,
      live
        ? { type: "status", id, status: "busy", at: Date.now() }
        : { type: "status", id, status: "idle", settled: true, at: end },
    ]).sessions.get(id)
    if (!fresh) return
    if (old?.parentID && !fresh.parentID) fresh.parentID = old.parentID
    if (old?.background) fresh.background = true
    if (old && old.seen > fresh.seen) fresh.seen = old.seen
    model.sessions.set(id, fresh)
    whole.add(id)
  }

  /** OpenCode 1: the conversation's subagents from the store, and theirs, two levels down. */
  const loadV1 = async (parent: string, depth: number): Promise<void> => {
    const children = (await host.session.children?.(parent).catch(() => [])) ?? []
    for (const child of children) {
      if (!whole.has(child.id)) {
        const messages = (await host.session.messages?.(child.id).catch(() => [])) ?? []
        const busy = await host.session.busy?.(child.id).catch(() => undefined)
        const past = slim(v1?.history(messages) ?? [])
        const end = Math.max(endOf(past, Number(child.time?.updated) || Date.now()), finishedAt(messages))
        rebuild(
          child.id,
          v1?.session({ ...child, parentID: child.parentID ?? parent }) ?? [],
          past,
          end,
          busy,
        )
        log.debug("history loaded", { id: child.id, messages: messages.length })
      }
      /** Only one that launched subagents has any; asking every child would cost a request each. */
      const launched = model.sessions
        .get(child.id)
        ?.entries.some(
          (entry) => entry.kind === "tool" && (entry.name === "task" || entry.name === "subagent"),
        )
      if (depth < 2 && launched) await loadV1(child.id, depth + 1)
    }
  }

  /**
   * OpenCode 2 has no list of children on the agent side; what the events named under this
   * conversation, but did not see start, is read from the store.
   */
  const loadV2 = async (root: string): Promise<void> => {
    for (const session of [...model.sessions.values()]) {
      if (whole.has(session.id) || session.id === root) continue
      if (!session.parentID) {
        const info = await host.session.get(session.id).catch(() => undefined)
        if (info?.parentID) session.parentID = info.parentID
        if (info?.title && !session.title) session.title = info.title
        if (info?.agent && session.agent === "agent") session.agent = info.agent
      }
      if (rootOf(model, session.id) !== root || !host.session.context) continue
      const messages = await host.session.context(session.id).catch(() => [])
      if (messages.length === 0) continue
      const past = slim(v2?.history(session.id, messages) ?? [])
      const end = Math.max(endOf(past, session.ended ?? Date.now()), finishedAt(messages))
      rebuild(
        session.id,
        [
          {
            type: "session",
            id: session.id,
            ...(session.parentID ? { parentID: session.parentID } : {}),
            ...(session.title ? { title: session.title } : {}),
            ...(session.agent !== "agent" ? { agent: session.agent } : {}),
            at: session.started,
          },
        ],
        past,
        end,
        undefined,
      )
    }
  }

  const load = async (root: string) => {
    if (v1) await loadV1(root, 0)
    else await loadV2(root)
  }

  const nodes = async (sessionID: string): Promise<Node[]> => {
    await load(sessionID).catch((error) => log.warn("history load failed", { error }))
    return subagentsOf(model, sessionID)
  }

  /** A subagent by id, from what is known or the store — or an error that lists the ones there are. */
  const find = async (id: string, sessionID: string): Promise<Session> => {
    let session = model.sessions.get(id)
    if (!session || !whole.has(id)) {
      await load(sessionID).catch((error) => log.warn("history load failed", { error }))
      session = model.sessions.get(id)
    }
    if (!session && v1 && host.session.messages) {
      /** Not under this conversation, but a session all the same: read it directly. */
      const info = await host.session.get(id).catch(() => undefined)
      if (info) {
        const messages = await host.session.messages(id).catch(() => [])
        const past = slim(v1.history(messages))
        rebuild(
          id,
          v1.session({ id, ...info }),
          past,
          Math.max(endOf(past, Date.now()), finishedAt(messages)),
          undefined,
        )
        session = model.sessions.get(id)
      }
    }
    if (session) return session
    const known = subagentsOf(model, sessionID)
    throw new Error(
      known.length === 0
        ? `no subagent "${id}": this conversation has none. Ids look like ses_… and come from the task result or subagents_list.`
        : `no subagent "${id}". This conversation's subagents:\n${known
            .map((node) => `- ${node.session.id} "${node.session.title || "subagent"}"`)
            .join("\n")}`,
    )
  }

  const wait = async (
    args: { ids?: string[]; any?: boolean; timeoutSeconds?: number },
    context: ToolContext,
  ): Promise<string> => {
    const started = Date.now()
    let targets: Session[]
    if (args.ids && args.ids.length > 0) {
      targets = []
      for (const id of [...new Set(args.ids)]) {
        if (id === context.sessionID) throw new Error("a subagent cannot wait on itself")
        targets.push(await find(id, context.sessionID))
      }
    } else {
      targets = (await nodes(context.sessionID))
        .map((node) => node.session)
        .filter((session) => !stateOf(session, started).over)
      if (targets.length === 0) {
        const all = subagentsOf(model, context.sessionID).map((node) => node.session)
        return all.length === 0
          ? "This conversation has no subagents, so there is nothing to wait on."
          : `None of this conversation's subagents is working; nothing to wait on.\n${waitReport({
              sessions: all,
              now: started,
              version: host.version,
              waited: 0,
              timedOut: false,
            })}`
      }
    }
    const ids = targets.map((session) => session.id)
    const current = () => ids.map((id) => model.sessions.get(id)).filter((s): s is Session => Boolean(s))
    /** Stopped, or held on the user: either way nothing more comes from it without someone acting. */
    const stopped = (session: Session) => {
      const state = stateOf(session, Date.now())
      return state.over || state.kind === "waiting"
    }
    const settled = () => (args.any ? current().some(stopped) : current().every(stopped))
    const timeout = Math.min(args.timeoutSeconds ?? 300, WAIT_MOST) * 1000
    const outcome = await new Promise<"done" | "timeout" | "cancelled">((resolve) => {
      if (settled()) return resolve("done")
      if (context.abort.aborted) return resolve("cancelled")
      let checking = false
      const finish = (how: "done" | "timeout" | "cancelled") => {
        listeners.delete(onChange)
        clearInterval(tick)
        clearTimeout(timer)
        context.abort.removeEventListener("abort", onAbort)
        resolve(how)
      }
      const onChange = () => {
        if (settled()) finish("done")
      }
      const onAbort = () => finish("cancelled")
      /**
       * An end the events never told — a missed idle — would hold the wait to its timeout. OpenCode 1
       * can be asked: one quiet for a while that the host says is idle is read again from the store.
       */
      const tick = setInterval(() => {
        if (checking || !v1 || !host.session.busy) return
        checking = true
        void (async () => {
          for (const session of current()) {
            if (stopped(session) || Date.now() - session.seen < 15_000) continue
            if ((await host.session.busy?.(session.id).catch(() => undefined)) !== false) continue
            whole.delete(session.id)
            await load(rootOf(model, session.id)).catch(() => {})
          }
        })().finally(() => {
          checking = false
          onChange()
        })
      }, 2_000)
      const timer = setTimeout(() => finish("timeout"), timeout)
      listeners.add(onChange)
      context.abort.addEventListener("abort", onAbort, { once: true })
    })
    const now = Date.now()
    return waitReport({
      sessions: current(),
      now,
      version: host.version,
      waited: now - started,
      timedOut: outcome === "timeout",
      cancelled: outcome === "cancelled",
    })
  }

  return {
    model,
    event,
    nodes,
    find,
    wait,
    forget: (id: string) => {
      model.sessions.delete(id)
      whole.delete(id)
    },
  }
}

export default dualServer("opencode-cockpit.subagents", createSubagentsServer())
