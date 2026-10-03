/**
 * `o`: both versions of a binary, in the system's own viewer.
 *
 * The honest answer to "what changed in this image": a preview at terminal resolution shows *where*,
 * never *what* — text in a 2880-pixel screenshot at fifty columns is noise. The old bytes come out of
 * git into a temporary file named `<name>@<revision><ext>`, so the viewer picks the right app and its
 * title bar says which side it is; the new side is the working copy itself.
 *
 * Everything that touches the system is injected, so tests never launch a real viewer.
 */

import { spawn as nodeSpawn } from "node:child_process"
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, extname, join } from "node:path"
import type { FileChange } from "./model/review.ts"

/** The opener each platform has, as a command and the arguments before the file. */
export function openerFor(platform: NodeJS.Platform): { command: string; args: string[] } {
  if (platform === "darwin") return { command: "open", args: [] }
  /** `start` is a shell builtin; its first quoted argument is a window title, hence the empty one. */
  if (platform === "win32") return { command: "cmd", args: ["/c", "start", ""] }
  return { command: "xdg-open", args: [] }
}

/** A launched process, as far as this file cares: it can fail to start, and it is not waited on. */
export interface Launched {
  on(event: "error", listener: (error: Error) => void): unknown
  unref(): void
}

export interface ViewerDeps {
  platform: NodeJS.Platform
  env: Record<string, string | undefined>
  /**
   * Finds a command on a PATH. `Bun.which`, given the PATH explicitly: `Bun.spawn` resolves a bare name
   * from the *parent's* PATH, not the env passed to it — the spike's PATH shim was bypassed until the
   * binary was resolved like this. It is also how "no opener here" is noticed and said.
   */
  which: (command: string, options: { PATH: string }) => string | null
  /** Starts the opener without waiting for it. Never `spawnSync`: on the TUI thread it takes the renderer down. */
  spawn: (command: string, args: string[], env: Record<string, string | undefined>) => Launched
  /** The old side's bytes, from git. */
  readOld: (file: FileChange) => Promise<Uint8Array | undefined>
  /** Where temporary copies go; one directory per pane, made on first use. */
  tmp?: string
  /** A launch that failed after `open` had already returned. */
  report: (problem: string) => void
}

/** The real system: Node's spawn (it has an `error` event; Bun's throws or exits instead), detached. */
export const systemSpawn: ViewerDeps["spawn"] = (command, args, env) =>
  nodeSpawn(command, args, { env, detached: true, stdio: "ignore" })

export const systemWhich: ViewerDeps["which"] = (command, options) => Bun.which(command, options)

const PREFIX = "cockpit-review-"
/** A leftover directory this old is from a pane that never closed cleanly — a crash, a kill. */
const STALE_MS = 24 * 60 * 60 * 1000

/** `shot@a1b2c3d.png`: the name, which side, and the extension the viewer goes by. */
export function oldName(file: FileChange): string {
  const path = file.from ?? file.path
  const extension = extname(path)
  const revision = file.binary?.revision ?? "old"
  const short = /^[0-9a-f]{12,}$/.test(revision) ? revision.slice(0, 7) : revision
  return `${basename(path, extension)}@${short}${extension}`
}

export interface Viewer {
  /**
   * Opens what there is of `file`: both sides, or the one an added or deleted file has. Resolves once
   * the openers are launched — not when anything is viewed. Says what went wrong, if anything did.
   */
  open: (cwd: string, file: FileChange) => Promise<{ opened: number; problem?: string }>
  /** Removes this pane's temporary copies. */
  clean: () => Promise<void>
}

export function createViewer(deps: ViewerDeps): Viewer {
  let dir: string | undefined
  let swept = false

  /** Leftovers from panes that did not close cleanly, swept once — only old ones, never a live pane's. */
  const sweep = async (root: string) => {
    if (swept) return
    swept = true
    const names = await readdir(root).catch(() => [] as string[])
    const now = Date.now()
    for (const name of names) {
      if (!name.startsWith(PREFIX)) continue
      const full = join(root, name)
      const info = await stat(full).catch(() => undefined)
      if (info && now - info.mtimeMs > STALE_MS)
        await rm(full, { recursive: true, force: true }).catch(() => {})
    }
  }

  const directory = async (): Promise<string> => {
    if (dir) return dir
    const root = deps.tmp ?? tmpdir()
    await sweep(root)
    dir = await mkdtemp(join(root, PREFIX))
    return dir
  }

  return {
    async open(cwd, file) {
      const { command, args } = openerFor(deps.platform)
      const PATH = deps.env.PATH ?? ""
      const opener = deps.which(command, { PATH })
      if (!opener) return { opened: 0, problem: `Nothing to open files with: ${command} is not on PATH` }

      const targets: string[] = []
      const binary = file.binary
      if (binary?.before) {
        const bytes = await deps.readOld(file)
        if (!bytes) return { opened: 0, problem: `Could not read the old ${basename(file.path)} from git` }
        const path = join(await directory(), oldName(file))
        await writeFile(path, bytes)
        targets.push(path)
      }
      if (!binary || binary.after) targets.push(join(cwd, file.path))

      for (const target of targets) {
        const launched = deps.spawn(opener, [...args, target], deps.env)
        launched.on("error", (error) => deps.report(`Could not open ${basename(target)}: ${error.message}`))
        launched.unref()
      }
      return { opened: targets.length }
    },
    async clean() {
      const was = dir
      dir = undefined
      if (was) await rm(was, { recursive: true, force: true }).catch(() => {})
    },
  }
}
