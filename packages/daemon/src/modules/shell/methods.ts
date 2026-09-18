import { invalidParams, invalidState } from "../../core/errors.ts"
import type { MethodTable } from "../../core/module.ts"
import type { ShellModule } from "./module.ts"
import { compilePattern } from "./module.ts"
import { waitFor } from "./wait.ts"
import { PRESETS, presetByName, presetForCommand } from "./watch/presets.ts"
import { compileRule, Watcher } from "./watch/watcher.ts"

/** Preset name for a watcher with no patterns: it only reports the process dying. */
const EXIT_ONLY = "exit"

/**
 * The `shell.*` methods, kept apart from the module's lifecycle and bookkeeping so each file has
 * one job: this one maps protocol calls onto the module, `module.ts` owns the shells.
 */
export function shellMethods(module: ShellModule): MethodTable<"shell"> {
  return {
    start: (params) => module.startShell(params),

    list: (params) => {
      const owner = params.owner
      return [...module.shells.values()]
        .filter((s) => params.includeExited || s.running)
        .filter((s) => !owner?.project || s.spec.owner.project === owner.project)
        .filter((s) => !owner?.session || s.spec.owner.session === owner.session)
        .map((s) => s.info())
    },

    get: ({ id }) => module.require(id).info(),

    read: ({ id, after, tail, limit, grep, ignoreCase }) => {
      const shell = module.require(id)
      const page = shell.log.read({
        after,
        tail,
        limit,
        grep: grep === undefined ? undefined : compilePattern(grep, ignoreCase),
      })
      return { ...page, status: shell.status }
    },

    screen: ({ id }) => module.require(id).snapshot(),

    write: ({ id, data }) => {
      const shell = module.require(id)
      if (!shell.running) throw invalidState(`shell ${id} is ${shell.status}`)
      return { bytes: shell.write(data) }
    },

    resize: ({ id, cols, rows }) => {
      module.require(id).resize(cols, rows)
      return {}
    },

    wait: async (params) => {
      const shell = module.require(params.id)
      const outcome = await waitFor(shell, params, compilePattern)
      return { ...outcome, info: shell.info() }
    },

    stop: async ({ id, signal, graceMs }, { peer }) => {
      const shell = module.require(id)
      await shell.stop(signal, graceMs, { reason: "request", by: peer.name })
      await shell.exited
      return shell.info()
    },

    restart: async ({ id }, { peer }) => {
      const shell = module.require(id)
      if (shell.running) {
        await shell.stop("SIGTERM", 3000, { reason: "request", by: peer.name })
        await shell.exited
      }
      module.spawn(shell)
      return shell.info()
    },

    remove: async ({ id }, { peer }) => {
      const shell = module.require(id)
      if (shell.running) {
        await shell.stop("SIGTERM", 3000, { reason: "request", by: peer.name })
        await shell.exited
      }
      module.forget(shell)
      return {}
    },

    attach: ({ id, fromOffset }, { peer }) => {
      const shell = module.require(id)
      module.detach(peer, id)
      const replay = shell.raw.since(fromOffset ?? 0)
      module.attachStream(peer, shell)
      return { offset: replay.offset, replay: Buffer.from(replay.bytes).toString("base64") }
    },

    clear: ({ owner, finishedBeforeMs }) => {
      const cutoff = Date.now() - (finishedBeforeMs ?? 0)
      const removed: string[] = []
      for (const shell of [...module.shells.values()]) {
        if (shell.running) continue
        const info = shell.info()
        if (owner?.project && info.owner.project !== owner.project) continue
        if (owner?.session && info.owner.session !== owner.session) continue
        if ((info.endedAt ?? 0) > cutoff) continue
        module.forget(shell)
        removed.push(info.id)
      }
      return { removed }
    },

    watch: ({ id, preset, rule }) => {
      const shell = module.require(id)
      const command = [shell.spec.command, ...shell.spec.args].join(" ")
      const named = preset && preset !== "auto" && preset !== EXIT_ONLY
      const chosen = rule
        ? undefined
        : named
          ? (presetByName(preset as string) ??
            invalidParams(
              `no watch preset named "${preset}". Call shell.presets for the list, or pass your own rule (done/fail/ok patterns).`,
            ))
          : preset === EXIT_ONLY
            ? undefined
            : presetForCommand(command)
      if (chosen instanceof Error) throw chosen
      // No pattern fits a command like `sleep 300`, and that is still worth watching: an empty rule
      // reports nothing until the process dies, which is exactly crash detection.
      const watchRule = rule ?? chosen?.rule ?? {}
      try {
        shell.watcher = new Watcher(compileRule(watchRule), chosen?.name ?? (rule ? undefined : EXIT_ONLY))
      } catch (err) {
        throw invalidParams(`invalid watch pattern: ${err instanceof Error ? err.message : String(err)}`)
      }
      shell.onWatchChange = (change) => {
        module.emit("shell.watch", { info: shell.info(), ...change })
      }
      module.armIdle(shell)
      return shell.info()
    },

    unwatch: ({ id }) => {
      const shell = module.require(id)
      shell.watcher = undefined
      shell.onWatchChange = undefined
      module.clearIdle(id)
      return shell.info()
    },

    presets: () => PRESETS.map((preset) => ({ name: preset.name, match: preset.match, rule: preset.rule })),

    detach: ({ id }, { peer }) => {
      module.detach(peer, id)
      return {}
    },
  }
}
