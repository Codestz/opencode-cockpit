/**
 * Trail's agent half: the two tools, the guidance on every request, and the safety net.
 *
 * The agent writes the trail — it alone knows what it just did, with whatever tools the person has —
 * and this half keeps what it says (docs/roadmap/v0.9/trail.md). Four layers make sure it does:
 *
 * 1. **The guidance** (`GUIDANCE`), in the system prompt of every request, subagents' included.
 * 2. **The tool's description**, when-to-call first: OpenCode 2's Code Mode catalog shows only its
 *    first ~115 characters (docs/opencode/trail-server.md).
 * 3. **Two lines rebuilt on every request** from the trail file, never from a summary: what this
 *    conversation produced (so it survives compaction), and PR or issue links seen in the output of
 *    something it ran and not recorded — worded as a choice, because a printed link is not a made one.
 * 4. **The measurement** (`measure/`): a fake `gh pr create` and a real turn that must end in trail_add.
 *
 * A record belongs to the conversation — the root session — whichever subagent made it, and says
 * which one did. Each keeps the conversation's title: OpenCode 2's agent half cannot list sessions,
 * and a deleted one is gone from both versions.
 */

import { type ToolDefinition, tool } from "@opencode-ai/plugin"
import { claimFeature, duplicateFeatureMessage } from "@opencode-cockpit/client"
import { dualServer, openText, type ServerHost, type ServerStart } from "@opencode-cockpit/client/server"
import { loadTrail } from "../core/config.ts"
import { createJournal } from "../core/journal.ts"
import { type Found, notRecorded } from "../core/model.ts"
import { trailPaths } from "../core/paths.ts"
import { addFinds, findsOf } from "../core/scan.ts"
import { emptyState, type State } from "../core/store.ts"
import {
  ADD_ARGS,
  ADD_DESCRIPTION,
  GUIDANCE,
  LIST_ARGS,
  LIST_DESCRIPTION,
  producedLine,
  seenLine,
} from "../core/text.ts"
import { runAdd, runList } from "../core/tools.ts"

export const TRAIL_PACKAGE = "@opencode-cockpit/trail"

/**
 * How long a link seen in output is put to the agent. Long enough for the turn that printed it and
 * the next one; not forever, or a link it rightly declined (one it only echoed) would ride along on
 * every request for the rest of the conversation. `/trail` keeps offering it to the person.
 */
export const SEEN_FOR_MS = 60 * 60_000

/** How far up `parentID` a subagent's session is walked to its conversation. */
const DEPTH = 8

export interface TrailServerOptions {
  source?: string
}

/** The session → conversation walk, cached: a session's parent never changes. */
export function createRoots(host: Pick<ServerHost, "session">) {
  const parents = new Map<string, string | null>()
  const parentOf = async (id: string): Promise<string | undefined> => {
    if (parents.has(id)) return parents.get(id) ?? undefined
    const info = await host.session.get(id).catch(() => undefined)
    /** Unknown is not cached: a lookup that failed now may answer next time. */
    if (info) parents.set(id, info.parentID ?? null)
    return info?.parentID
  }
  return {
    rootOf: async (id: string): Promise<string> => {
      let at = id
      for (let hop = 0; hop < DEPTH; hop++) {
        const parent = await parentOf(at)
        if (!parent) return at
        at = parent
      }
      return at
    },
  }
}

/** The agent half as a factory, so the `opencode-cockpit` bundle can include it. */
export function createTrailServer({ source = TRAIL_PACKAGE }: TrailServerOptions = {}): ServerStart {
  return async (host, rawOptions) => {
    const log = host.log.child("trail")
    const { settings, notices } = loadTrail(host.directory, rawOptions)
    for (const notice of notices) log.warn("settings", { notice })
    if (!settings.enabled) {
      log.info("off by config", { directory: host.directory })
      return {}
    }
    const claim = claimFeature(host.scope, "trail", source)
    if (!claim.active) {
      log.warn(duplicateFeatureMessage("Trail", claim.owner, source))
      return {}
    }

    const paths = trailPaths(host.directory)
    const journal = createJournal(paths)
    let state: State = emptyState()
    /** Every window, and on OpenCode 1 every directory's instance, appends to the same file. */
    const sync = async () => {
      state = await journal.sync(state).catch((error) => {
        log.warn("trail unreadable", { file: paths.events, error })
        return state
      })
      return state
    }
    const roots = createRoots(host)
    /** PR and issue links seen in what each conversation ran, by its root session. */
    const seen = new Map<string, Found[]>()

    const who = async (sessionID: string, agent: string | undefined) => {
      const root = await roots.rootOf(sessionID)
      const title = (await host.session.get(root).catch(() => undefined))?.title
      return {
        session: sessionID,
        rootSession: root,
        ...(title ? { sessionTitle: title } : {}),
        by: "agent" as const,
        /** The subagent that made it: `agent` names the one running in the session that called. */
        ...(sessionID !== root && agent ? { subagent: agent } : {}),
        at: Date.now(),
      }
    }

    const z = tool.schema
    const add: ToolDefinition = tool({
      description: ADD_DESCRIPTION,
      args: {
        title: z.string().describe(ADD_ARGS.title),
        url: z.string().optional().describe(ADD_ARGS.url),
        ref: z.string().optional().describe(ADD_ARGS.ref),
        kind: z.string().optional().describe(ADD_ARGS.kind),
        action: z.string().optional().describe(ADD_ARGS.action),
        for: z.string().optional().describe(ADD_ARGS.for),
        note: z.string().optional().describe(ADD_ARGS.note),
      },
      async execute(args, context) {
        await sync()
        const out = runAdd(state, args, await who(context.sessionID, context.agent))
        if (!out.ok) {
          log.debug("refused", { sessionID: context.sessionID, why: out.text })
          return out.text
        }
        await journal.append([out.event])
        log.info("recorded", {
          session: out.event.rootSession,
          url: out.event.url,
          ref: out.event.ref,
          action: out.event.action,
          ...(out.event.subagent ? { subagent: out.event.subagent } : {}),
        })
        return out.text
      },
    })

    const list: ToolDefinition = tool({
      description: LIST_DESCRIPTION,
      args: {
        all: z.boolean().optional().describe(LIST_ARGS.all),
        query: z.string().optional().describe(LIST_ARGS.query),
      },
      async execute(args, context) {
        await sync()
        return runList(state, args, await roots.rootOf(context.sessionID), Date.now())
      },
    })

    return {
      tools: { trail_add: add, trail_list: list },
      /** For the Cockpit-wide line: the trail is in the sidebar, or only behind `/trail`. */
      surfaces: [
        {
          what: "this conversation's trail",
          ...(settings.sidebar ? {} : { where: "the trail view" }),
          open: openText("trail", "cockpit.trail.open", settings.keybinds, "trail"),
        },
      ],
      /** Before every model request, the subagents' too: the guidance, and the two lines for this conversation. */
      system: async (sessionID) => {
        if (!sessionID) return [GUIDANCE]
        const root = await roots.rootOf(sessionID)
        await sync()
        const since = Date.now() - SEEN_FOR_MS
        const fresh = (seen.get(root) ?? []).filter((found) => found.at >= since)
        return [GUIDANCE, producedLine(state, root), seenLine(notRecorded(state, root, fresh))].filter(
          (line): line is string => line !== undefined,
        )
      },
      toolAfter: async (call) => {
        const found = findsOf(call, Date.now())
        if (found.length === 0) return
        const root = await roots.rootOf(call.sessionID)
        const list = seen.get(root) ?? []
        if (addFinds(list, found))
          log.debug("seen", { session: root, tool: call.tool, urls: found.map((f) => f.url) })
        seen.set(root, list)
      },
      /** A deleted conversation keeps its records, marked; OpenCode cannot say its title afterwards. */
      sessionDeleted: async (sessionID) => {
        seen.delete(sessionID)
        await sync()
        const has = [...state.records.values()].some((record) => record.session === sessionID)
        if (!has || state.conversations.get(sessionID)?.deletedAt !== undefined) return
        await journal.append([
          { v: 1, at: Date.now(), id: `del_${sessionID}`, type: "deleted", rootSession: sessionID },
        ])
        log.info("conversation deleted; its records stay", { session: sessionID })
      },
      dispose: () => claim.release(),
    }
  }
}

export default dualServer("opencode-cockpit.trail", createTrailServer())
