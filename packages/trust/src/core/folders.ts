/**
 * Folders outside the project: what OpenCode's `external_directory` asks about, and how a place
 * outside the project is said in a few cells.
 *
 * OpenCode asks `external_directory` before a tool reads or writes anything outside the project, with
 * the folder as a glob — `/abs/dir/*` (its `patterns` on 1, `resources` on 2). On a user's ledger it
 * was 522 of 9,149 prompts, almost all of them in the OS temp dir (`/var/folders/…/T/opencode/…`), and
 * every one approved by hand. So a folder is counted, like any subject — and never answered by its
 * count: a folder approved three times is still a person's call (`answersByCount`). What answers it is
 * a folder the person widened with `w`, which covers the folders under it (`under`), never its
 * siblings; and the temp dir is one family, `$TMPDIR/`, so one widening covers every scratch folder
 * an agent makes there.
 *
 * Some folders are never suggested and never widened, however often they are approved (`refused`): the
 * disk's root, your home folder and what holds it, the folders keys and settings live in (`~/.ssh`,
 * `~/.aws`, `~/.config`, `/etc`…), anything that may hold secrets (effect.ts `sensitive`), and a folder
 * that holds the project — widening it would answer for every project beside this one.
 *
 * The machine's own folders are read once, when Trust loads: the home folder and the temp dir do not
 * move under a running OpenCode. Nothing here touches the disk.
 */

import { homedir, tmpdir } from "node:os"
import { posix } from "node:path"
import { sensitive } from "./effect.ts"
import { canonical } from "./rules.ts"

/** The permission OpenCode asks before a tool touches anything outside the project. */
export const OUTSIDE = "external_directory"

/** The temp dir, as one family: every folder in it is the same place to a person. */
export const TEMP_FAMILY = "$TMPDIR/"

/**
 * Whether a subject's own count can answer it. Everything's can — except a folder outside the
 * project, which only a widening answers.
 */
export const answersByCount = (permission: string): boolean => canonical(permission) !== OUTSIDE

const trimmed = (path: string) => (path === "/" ? "/" : path.replace(/\/+$/, ""))

/**
 * The temp dir under every name it goes by. `os.tmpdir()` on macOS is `/var/folders/…/T`, whose real
 * path is `/private/var/folders/…/T` — tools report either, so both are listed (the realpath, said as
 * text: nothing is read from disk). `/tmp` and `/private/tmp` are the same place on every Unix.
 */
export function tempRootsOf(dir: string): string[] {
  const base = trimmed(posix.normalize(dir))
  const roots = new Set([base, "/tmp", "/private/tmp"])
  if (base.startsWith("/private/")) roots.add(base.slice("/private".length))
  else if (/^\/(var|tmp)(\/|$)/.test(base)) roots.add(`/private${base}`)
  /** The longest first, so `$TMPDIR/x` is read from the whole temp dir, not from `/tmp` inside it. */
  return [...roots].sort((a, b) => b.length - a.length)
}

/** The temp dir as the OS names it, for a config rule that has to spell it out. */
export const TEMP_DIR = trimmed(posix.normalize(tmpdir()))
const TEMP_ROOTS = tempRootsOf(TEMP_DIR)
const HOME = trimmed(posix.normalize(homedir()))

/** `path` is `root` or inside it. */
const within = (path: string, root: string) =>
  path === root || path.startsWith(root === "/" ? "/" : `${root}/`)

/** The temp dir `path` is in, by the name it was given. */
const tempRootOf = (path: string) => TEMP_ROOTS.find((root) => within(trimmed(path), root))

export const isTemp = (path: string): boolean => tempRootOf(path) !== undefined

/**
 * The folder a request names, from its glob: `/abs/dir/*` is `/abs/dir/`. Always absolute and ending
 * in `/`; anything else — a relative path, an empty one — is not read as a folder.
 */
export function folderOf(pattern: string): string | undefined {
  const bare = pattern.replace(/\*+$/, "")
  if (!posix.isAbsolute(bare)) return undefined
  const folder = trimmed(posix.normalize(bare))
  return folder === "/" ? "/" : `${folder}/`
}

/** A folder's family: the temp dir is one (`$TMPDIR/`); any other folder is its own. */
export const folderFamily = (folder: string): string => (isTemp(folder) ? TEMP_FAMILY : folder)

/** Folders that hold keys and settings: never widened, and nothing under them either. */
const KEPT = [".ssh", ".aws", ".gnupg", ".config", ".kube", ".docker"]
const SYSTEM = ["/etc", "/private/etc"]

/**
 * Why a folder outside the project is never suggested or widened — or nothing when it may be. `root`,
 * when known, is the project: a folder that holds it would answer for every project beside it.
 */
export function refused(folder: string, root?: string): string | undefined {
  if (folder === TEMP_FAMILY) return undefined
  const path = trimmed(posix.normalize(folder))
  if (path === "/") return "it is the whole disk"
  if (within(HOME, path)) return path === HOME ? "it is your home folder" : "it holds your home folder"
  if (KEPT.some((name) => within(path, `${HOME}/${name}`)) || SYSTEM.some((dir) => within(path, dir)))
    return "keys and settings live there"
  if (sensitive(path) || sensitive(`${path}/`)) return "it may hold secrets"
  if (root !== undefined && within(trimmed(posix.normalize(root)), path)) return "it holds the project"
  return undefined
}

/** A widened folder answers `folder`: it is that folder or under it — never a sibling. */
export function under(folder: string, family: string): boolean {
  if (family === TEMP_FAMILY) return isTemp(folder)
  return within(trimmed(folder), trimmed(family))
}

/** Every folder a widening of which would answer `folder`: its family, itself, and each folder above it. */
export function widenersOf(folder: string): string[] {
  const out = new Set([folderFamily(folder)])
  let path = trimmed(folder)
  while (path !== "/" && path !== ".") {
    out.add(`${path}/`)
    path = posix.dirname(path)
  }
  return [...out]
}

/**
 * A path as a person reads it: the temp dir as `$TMPDIR`, the home folder as `~`. Nothing is cut:
 * `$TMPDIR/opencode/a1b2/`, `~/work/other/`.
 */
export function shortPath(path: string): string {
  if (path === TEMP_FAMILY) return path
  const temp = tempRootOf(path)
  if (temp !== undefined) return `$TMPDIR${path.slice(temp.length)}`
  if (within(trimmed(path), HOME)) return `~${path.slice(HOME.length)}`
  return path
}

/**
 * Where a command ran, in a few cells, for the end of its row: a folder in the project as itself
 * (`packages/api`), one outside as its last two folders after `~`, `$TMPDIR` or `/` —
 * `~/…/support-data-uploader/scripts`. The project's folders are short already; an absolute one is
 * what pushed the command off the row.
 */
export function shortPlace(place: string): string {
  if (!posix.isAbsolute(place)) return place
  const short = shortPath(place)
  const [head, ...rest] = trimmed(short).split("/")
  const parts = rest.filter((part) => part !== "")
  if (parts.length <= 2) return short
  return `${head}/…/${parts.slice(-2).join("/")}`
}
