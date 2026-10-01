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
  routeNotice,
  subagentNote,
} from "../core/notice.ts"
import { createTools } from "./tools/index.ts"

const GUIDANCE = `## Background shells (opencode-cockpit)
Long-running or interactive commands (dev servers, watchers, slow builds/tests, REPLs) go in shell_start, not bash with "&".
Block with shell_wait (pattern, port, idle, exit) instead of sleeping; follow output with shell_read(after=cursor).
You are messaged when a shell you started exits.
For processes that never exit (tsc --watch, vitest --watch, dev servers), shell_watch reports only when their health changes — use it instead of re-reading their logs.`

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
  ): Promise<void> {
    const origin = info.owner.origin
    const busy = origin && origin !== info.owner.session ? await originBusy(origin) : undefined
    const route = routeNotice({ owner: info.owner, outcome, originBusy: busy })
    log.debug(`${what} notice`, { shell: info.id, origin, busy, outcome, route })
    if (route.kind === "drop") return
    if (route.kind === "deliver") {
      await host.session.notify(route.session, await text(), { steer: route.steer })
      return
    }
    const sub = {
      session: route.subagent,
      agent:
        subagents.get(route.subagent)?.agent ??
        (await host.session.get(route.subagent).catch(() => undefined))?.agent,
      title: await sessionTitle(route.subagent).catch(() => undefined),
    }
    await host.session.notify(route.session, `${await text()}\n${subagentNote(sub, host.version)}`)
  }

  // Tell the agent that started a shell when it ends on its own.
  cockpit.on("shell.exited", (info) => {
    if (info.owner.instance !== instance || !info.owner.session) return
    if (quiet.delete(info.id) || config.notify?.exit === false) return
    const tail = async () => {
      const page = await cockpit.call("shell.read", { id: info.id, tail: config.notify?.tailLines ?? 15 })
      return exitText(info, page.lines)
    }
    void deliver(info, exitOutcome(info), tail, "exit").catch((error) =>
      log.warn("exit notice not delivered", { shell: info.id, error }),
    )
  })

  // A watcher's health changed. This is the whole point of watching: one message per change, never
  // per line, so a thousand identical recompiles cost nothing.
  cockpit.on("shell.watch", (event) => {
    const info = event.info
    if (config.notify?.watch === false) return
    if (info.owner.instance !== instance || !info.owner.session || event.current === "pending") return
    void deliver(info, healthOutcome(event.current), async () => healthText(info, event), "health").catch(
      (error) => log.warn("health notice not delivered", { shell: info.id, error }),
    )
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
      if (config.guidance !== false) system.push(GUIDANCE)
      /** Shells are owned by the conversation, so "is this mine?" has to ask about the same thing. */
      const here = (await rootSession(sessionID).catch(() => undefined)) ?? sessionID
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
