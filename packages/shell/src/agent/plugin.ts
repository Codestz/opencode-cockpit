import { claimFeature, duplicateFeatureMessage } from "@opencode-cockpit/client"
import {
  dualServer,
  type ServerHost,
  type ServerParts,
  type ServerStart,
} from "@opencode-cockpit/client/server"
import type { ShellInfo } from "@opencode-cockpit/protocol/shell"
import { createClient } from "../connect.ts"
import { loadConfig } from "../core/config.ts"
import { describeStatus } from "../core/format.ts"
import {
  activityOf,
  exitOutcome,
  exitText,
  healthOutcome,
  healthText,
  type Outcome,
  type Relayed,
  relayed,
  relayText,
  routeNotice,
  subagentNote,
} from "../core/notice.ts"
import { createTools } from "./tools/index.ts"

const GUIDANCE = `## Background shells (opencode-cockpit)
Long-running or interactive commands (dev servers, watchers, slow builds/tests, REPLs) go in shell_start, not bash with "&".
Block with shell_wait (pattern, port, idle, exit) instead of sleeping; follow output with shell_read(after=cursor).
You are messaged when a shell you started exits, and — once that subagent finishes — when a shell one of your subagents started failed; shell_list says which subagent started each shell.
For processes that never exit (tsc --watch, vitest --watch, dev servers), shell_watch reports only when their health changes — use it instead of re-reading their logs.`

/**
 * What a subagent is told on OpenCode 1, where it is never messaged while it works (core/notice.ts:
 * the message would become its answer): to look at its shells itself before it answers.
 */
const SUBAGENT_V1 =
  "As a subagent on this OpenCode you are not messaged about your shells while you work — a message would replace your answer. Before you answer, check the shells you started with shell_wait or shell_list; a failure you leave is reported to your caller once you finish."

/** The guidance for one session: a subagent on OpenCode 1 is told it hears nothing while it works. */
export function shellGuidance(version: 1 | 2, subagent: boolean): string {
  return version === 1 && subagent ? `${GUIDANCE}\n${SUBAGENT_V1}` : GUIDANCE
}

export const SHELL_PACKAGE = "@opencode-cockpit/shell"

export interface ShellServerOptions {
  /** Package that loaded Shell, reported when a duplicate copy is skipped. */
  source?: string
}

/** Shell's server half as a factory, so bundles such as `opencode-cockpit` can include it. */
export function createShellServer({ source = SHELL_PACKAGE }: ShellServerOptions = {}): ServerStart {
  return async (host, options) => {
    const claim = claimFeature(host.scope, "shell", source)
    if (!claim.active) {
      host.log.warn(duplicateFeatureMessage("Shell", claim.owner, source))
      return {}
    }
    const parts = await shellParts(host, options)
    return {
      ...parts,
      dispose: async () => {
        claim.release()
        await parts.dispose?.()
      },
    }
  }
}

async function shellParts(host: ServerHost, options?: unknown): Promise<ServerParts> {
  const { directory } = host
  const log = host.log.child("shell")
  const config = loadConfig(directory, options)
  // Identifies this OpenCode window to the daemon, so shells can end with it.
  const instance = crypto.randomUUID()
  const cockpit = createClient("opencode-cockpit/server", instance)
  const quiet = new Set<string>()

  const userShell =
    process.env.SHELL && /(bash|zsh|fish|sh)$/.test(process.env.SHELL) ? process.env.SHELL : "/bin/bash"
  const env = () => {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env))
      if (v !== undefined && !k.startsWith("OPENCODE_")) out[k] = v
    return out
  }

  /**
   * The conversation a session belongs to.
   *
   * A tool called from a subagent runs in a *child* session, and stamping a shell with that id
   * hides it from the conversation you are looking at: the panel filters by the session it is
   * showing, so the agent's own shells appear only under "whole project". Walking up `parentID`
   * puts them where the person who asked for them is.
   *
   * Cached, and the chain is bounded — a cycle in session parentage would otherwise be a hang, and
   * this runs on the path that starts a shell.
   */
  const roots = new Map<string, { root: string; at: number }>()
  const rootSession = async (sessionID: string | undefined): Promise<string | undefined> => {
    if (!sessionID) return undefined
    const hit = roots.get(sessionID)
    if (hit && Date.now() - hit.at < 60_000) return hit.root
    let at = sessionID
    for (let hop = 0; hop < 8; hop++) {
      const parent = (await host.session.get(at))?.parentID
      if (!parent || parent === at) break
      at = parent
    }
    roots.set(sessionID, { root: at, at: Date.now() })
    return at
  }

  // Session titles rarely change; cache them so listing shells stays one round trip.
  const titles = new Map<string, { title: string | undefined; at: number }>()
  const sessionTitle = async (sessionID: string): Promise<string | undefined> => {
    const hit = titles.get(sessionID)
    if (hit && Date.now() - hit.at < 60_000) return hit.title
    const title = (await host.session.get(sessionID))?.title
    titles.set(sessionID, { title, at: Date.now() })
    return title
  }

  /**
   * Subagents that started a shell in this window: the agent they ran as (only the tool call says),
   * and whether they are working on a turn now. OpenCode 1 answers "busy?" itself; OpenCode 2's
   * agent side cannot, so there the answer is followed from session events, starting from "busy" —
   * a subagent calling shell_start is mid-turn. Only these sessions are followed, so it stays small.
   */
  const subagents = new Map<string, { agent?: string; busy: boolean }>()
  const originBusy = async (session: string): Promise<boolean | undefined> => {
    const asked = await host.session.busy?.(session).catch(() => undefined)
    return asked ?? subagents.get(session)?.busy
  }

  /**
   * Sends a notice to whoever should hear it (core/notice.ts decides). `text` is built only when
   * someone will read it, since an exit notice reads the shell's tail from the daemon.
   */
  async function deliver(
    info: ShellInfo,
    outcome: Outcome,
    text: () => Promise<string>,
    what: string,
    brief: string,
  ): Promise<void> {
    const origin = info.owner.origin
    const busy = origin && origin !== info.owner.session ? await originBusy(origin) : undefined
    const route = routeNotice({ owner: info.owner, outcome, originBusy: busy, version: host.version })
    log.debug(`${what} notice`, { shell: info.id, origin, busy, outcome, route })
    /** A shell that recovered is no longer news for the conversation. */
    if (origin && outcome === "clean") relays.get(origin)?.delete(info.id)
    if (route.kind === "drop") return
    if (relayed(route, info.owner, outcome) && info.owner.session) {
      const subagent = route.kind === "hold" ? route.subagent : route.session
      const pending = relays.get(subagent) ?? new Map<string, Relayed & { root: string }>()
      pending.set(info.id, { id: info.id, title: info.title, status: brief, root: info.owner.session })
      relays.set(subagent, pending)
    }
    /** Held, on OpenCode 1: the subagent is told nothing, the conversation hears when it finishes. */
    if (route.kind === "hold") {
      /** Finished while we asked: the event that relays has passed, so relay now. */
      if ((await originBusy(route.subagent)) === false) await relay(route.subagent)
      return
    }
    if (route.kind === "deliver") {
      await host.session.notify(route.session, await text(), { steer: route.steer })
      return
    }
    const sub = await describeSubagent(route.subagent)
    await host.session.notify(route.session, `${await text()}\n${subagentNote(sub, host.version)}`)
  }

  const describeSubagent = async (session: string) => ({
    session,
    agent: subagents.get(session)?.agent ?? (await host.session.get(session).catch(() => undefined))?.agent,
    /** OpenCode 1 titles a subagent "Task (@general subagent)"; the agent is named apart. */
    title: (await sessionTitle(session).catch(() => undefined))?.replace(/\s*\(@[\w-]+ subagent\)\s*$/, ""),
  })

  /**
   * Failures told to a subagent mid-run, by subagent: the conversation hears of them when that
   * subagent's run ends (core/notice.ts says why). Kept until then; a shell that recovers leaves.
   */
  const relays = new Map<string, Map<string, Relayed & { root: string }>>()
  const relay = async (subagent: string) => {
    const pending = relays.get(subagent)
    relays.delete(subagent)
    if (!pending || pending.size === 0) return
    const shells = [...pending.values()]
    const root = (shells[0] as { root: string }).root
    const text = relayText(await describeSubagent(subagent), shells, host.version)
    log.debug("relay notice", { subagent, root, shells: shells.map((shell) => shell.id) })
    await host.session.notify(root, text)
  }

  // Tell the agent that started a shell when it ends on its own.
  cockpit.on("shell.exited", (info) => {
    if (info.owner.instance !== instance || !info.owner.session) return
    if (quiet.delete(info.id) || config.notify?.exit === false) return
    const tail = async () => {
      const page = await cockpit.call("shell.read", { id: info.id, tail: config.notify?.tailLines ?? 15 })
      return exitText(info, page.lines)
    }
    void deliver(info, exitOutcome(info), tail, "exit", describeStatus(info)).catch((error) =>
      log.warn("exit notice not delivered", { shell: info.id, error }),
    )
  })

  // A watcher's health changed. This is the whole point of watching: one message per change, never
  // per line, so a thousand identical recompiles cost nothing.
  cockpit.on("shell.watch", (event) => {
    const info = event.info
    if (config.notify?.watch === false) return
    if (info.owner.instance !== instance || !info.owner.session || event.current === "pending") return
    const brief = `${info.watch?.preset ?? "watch"} reports ${event.current}${event.summary ? `: ${event.summary}` : ""}`
    void deliver(
      info,
      healthOutcome(event.current),
      async () => healthText(info, event),
      "health",
      brief,
    ).catch((error) => log.warn("health notice not delivered", { shell: info.id, error }))
  })

  return {
    tools: createTools({
      client: cockpit,
      instance,
      quiet,
      env,
      config,
      sessionTitle,
      rootSession,
      subagentStarted: (session, agent) => {
        subagents.set(session, { agent: agent || subagents.get(session)?.agent, busy: true })
      },
      shellCommand: (command) => ({ command: userShell, args: ["-c", command] }),
    }),

    system: async (sessionID) => {
      const system: string[] = []
      /** Shells are owned by the conversation, so "is this mine?" has to ask about the same thing. */
      const here = (await rootSession(sessionID).catch(() => undefined)) ?? sessionID
      if (config.guidance !== false) system.push(shellGuidance(host.version, here !== sessionID))
      const listLimit = config.listRunningShells ?? 15
      if (listLimit <= 0) return system
      const running = await cockpit
        .call("shell.list", { owner: { project: directory }, includeExited: false })
        .catch(() => [] as ShellInfo[])
      if (running.length > 0) {
        system.push(
          `Background shells currently running in this project:\n${running
            .slice(0, listLimit)
            .map((s) => {
              const from = !s.owner.session
                ? ", started by the user"
                : s.owner.session === here
                  ? ""
                  : ", another session"
              const health = s.watch ? `, ${s.watch.preset ?? "watch"}: ${s.watch.status}` : ""
              return `- ${s.id} "${s.title}" (${describeStatus(s)}${from}${health})`
            })
            .join("\n")}`,
        )
      }
      return system
    },

    event: (event) => {
      const activity = activityOf(event)
      const known = activity && subagents.get(activity.session)
      if (known) known.busy = activity.busy
      if (activity && !activity.busy && relays.has(activity.session))
        void relay(activity.session).catch((error) =>
          log.warn("relay notice not delivered", { subagent: activity.session, error }),
        )
    },

    sessionDeleted: async (sessionID) => {
      subagents.delete(sessionID)
      const owned = await cockpit
        .call("shell.list", { owner: { session: sessionID } })
        .catch(() => [] as ShellInfo[])
      for (const shell of owned) {
        quiet.add(shell.id)
        await cockpit.call("shell.remove", { id: shell.id }).catch(() => {})
      }
    },

    dispose: async () => {
      cockpit.close()
    },
  }
}

export default dualServer("opencode-cockpit.shell", createShellServer())
