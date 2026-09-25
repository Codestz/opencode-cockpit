import { type ToolDefinition, tool } from "@opencode-ai/plugin"
import { claimFeature, duplicateFeatureMessage } from "@opencode-cockpit/client"
import { dualServer, type ServerHost, type ServerStart } from "@opencode-cockpit/client/server"
import { createV1Translator } from "../core/adapt/v1.ts"
import { createV2Translator } from "../core/adapt/v2.ts"
import type { Change } from "../core/model/changes.ts"
import { applyAll, emptyModel, type Model, type Node, subagentsOf } from "../core/model/model.ts"
import { subagentReport } from "../core/view/report.ts"

/**
 * What the agent is told about subagents, once per request.
 *
 * Measured on both OpenCodes (docs/opencode/agents.md): a subagent launched in the background lets the
 * conversation carry on, and the main agent is told when it finishes. OpenCode 2 offers it on its
 * `subagent` tool; OpenCode 1 only with `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true`, which a
 * plugin cannot set — so the guidance says "if your tool offers it", and never promises it.
 *
 * Continuing a subagent was measured too: given its id, the same subagent picks up with everything it
 * already read, and answers in seconds. Main agents rarely do it on their own — the id scrolls away —
 * so the guidance asks for it, and `subagents_list` hands the ids back.
 */
export const GUIDANCE = `## Subagents (opencode-cockpit)
When you delegate independent work to a subagent, launch it with background: true if your task or subagent tool offers that option, so this conversation continues while it works; you are notified when it finishes. Work on something else meanwhile, or tell the user what you launched.
When the user asks for a fix or follow-up on work a subagent already did, continue that same subagent (task_id or sessionID) rather than launching a new one — it keeps its context. subagents_list gives each subagent's id, task and last answer.
The user can watch each subagent and message it directly; when they do, a note in this conversation tells you what they asked and what it answered.`

const LIST = `List the subagents of this conversation: each one's id, agent, task, state and last answer.

Use it before following up on work a subagent did, to continue that same subagent by its id instead of starting a new one — it keeps everything it already read and tried.`

export const SUBAGENTS_PACKAGE = "@opencode-cockpit/subagents"

export interface SubagentsServerOptions {
  source?: string
}

/**
 * What the agent side keeps of each run: enough to list it — not what calls printed, nor thinking, so
 * a long session does not hold every file its subagents read.
 */
export function slim(changes: Change[]): Change[] {
  const out: Change[] = []
  for (const change of changes) {
    if (change.type === "thinking") continue
    if (change.type === "tool") {
      const { output: _output, input: _input, ...rest } = change
      out.push(rest)
    } else out.push(change)
  }
  return out
}

/**
 * The conversation's subagents: what the events said, and on OpenCode 1 any from before we started —
 * with their history, read once. Listed bare, those read "working now · 0 calls" to the main agent,
 * which then waits on work long finished, or does it again.
 */
async function nodesFor(
  host: ServerHost,
  model: Model,
  history: (messages: { info: unknown; parts: unknown[] }[]) => Change[],
  sessionID: string,
): Promise<Node[]> {
  const listed = (await host.session.children?.(sessionID).catch(() => [])) ?? []
  const missing = listed.filter((child) => (model.sessions.get(child.id)?.entries.length ?? 0) === 0)
  for (const child of missing) {
    const at = child.time?.updated ?? Date.now()
    const messages = (await host.session.messages?.(child.id).catch(() => [])) ?? []
    applyAll(model, [
      {
        type: "session",
        id: child.id,
        parentID: sessionID,
        ...(child.title ? { title: child.title } : {}),
        at,
      },
      ...slim(history(messages)),
      { type: "status", id: child.id, status: "idle", at },
    ])
  }
  return subagentsOf(model, sessionID)
}

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
    const model = emptyModel()
    const v1 = host.version === 1 ? createV1Translator() : undefined
    const translate = v1 ?? createV2Translator()
    const history = (messages: { info: unknown; parts: unknown[] }[]) => v1?.history(messages) ?? []

    const list: ToolDefinition = tool({
      description: LIST,
      args: {},
      async execute(_args, context) {
        const nodes = await nodesFor(host, model, history, context.sessionID)
        log.debug("list", { sessionID: context.sessionID, count: nodes.length })
        return subagentReport({ nodes, now: Date.now(), version: host.version })
      },
    })

    return {
      ...(options.guidance === false ? {} : { system: async () => [GUIDANCE] }),
      tools: { subagents_list: list },
      event: (event) => {
        try {
          const changes = slim(translate.event(event))
          if (changes.length > 0) applyAll(model, changes)
        } catch (error) {
          log.warn("event failed", { error })
        }
      },
      sessionDeleted: async (sessionID) => {
        model.sessions.delete(sessionID)
      },
      dispose: () => claim.release(),
    }
  }
}

export default dualServer("opencode-cockpit.subagents", createSubagentsServer())
