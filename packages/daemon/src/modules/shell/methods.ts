import { invalidParams, invalidState } from "../../core/errors.ts"
import type { MethodTable } from "../../core/module.ts"
import type { ShellModule } from "./module.ts"
import { compilePattern } from "./module.ts"
import { waitFor } from "./wait.ts"
import { PRESETS, presetByName, presetForCommand } from "./watch/presets.ts"
import { compileRule, Watcher } from "./watch/watcher.ts"

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

    stop: async ({ id, signal, graceMs }) => {
      const shell = module.require(id)
      await shell.stop(signal, graceMs)
      await shell.exited
      return shell.info()
    },

    restart: async ({ id }) => {
      const shell = module.require(id)
      if (shell.running) {
        await shell.stop("SIGTERM", 3000)
        await shell.exited
      }
      module.spawn(shell)
      return shell.info()
    },

    remove: async ({ id }) => {
      const shell = module.require(id)
      if (shell.running) {
        await shell.stop("SIGTERM", 3000)
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
      const chosen = rule
        ? undefined
        : preset && preset !== "auto"
          ? (presetByName(preset) ??
            invalidParams(`unknown preset "${preset}"; call shell.presets for the list`))
          : presetForCommand(command)
      if (chosen instanceof Error) throw chosen
      const watchRule = rule ?? chosen?.rule
      if (!watchRule) {
        throw invalidParams(
          `no watch preset matches "${command.slice(0, 80)}"; pass a rule (done/fail/ok patterns) or a preset name`,
        )
      }
      try {
        shell.watcher = new Watcher(compileRule(watchRule), chosen?.name)
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
