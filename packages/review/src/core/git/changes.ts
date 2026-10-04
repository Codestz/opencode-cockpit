/**
 * Changes git knows about, decided: which files changed, how, and what a reviewer should be shown —
 * as plain functions of what git said and of the bytes read, so a test can drive them with no
 * repository at all. Asking git and reading the files is `io/git.ts`.
 */

import { countChanges, diffLines } from "../diff/hunks.ts"
import { looksBinary, sniff } from "../image/sniff.ts"
import type { BinarySide, FileChange } from "../model/review.ts"

export interface GitResult {
  files: FileChange[]
  /** What could not be read, phrased for a person: shown rather than swallowed. */
  errors: string[]
  /** For branch mode: what it compared against. */
  base?: string
}

/** More than this and the pane is not the right tool — and reading them all would stall the TUI. */
export const MAX_FILES = 200
/** A text file bigger than this is almost certainly not being read line by line. */
export const MAX_BYTES = 400_000
/**
 * A binary is read whole up to this — its own cap, far above the text one.
 *
 * Every real screenshot is over 400 KB, and under the text cap each one was skipped with "too large
 * to review here": the file most worth a look silently was not in the review. Past this the header
 * is still read, so the file is still named, sized and described.
 */
export const MAX_BINARY_BYTES = 32 * 1024 * 1024

/** Some or all of a file's bytes, and how many there are in all. */
export interface Read {
  bytes: Uint8Array
  size: number
  /** False when only the first bytes were read, the file being over the cap. */
  whole: boolean
}

/** UTF-8, with a byte-order mark kept on both sides alike, so a BOM is never a change of its own. */
const decoder = new TextDecoder("utf-8", { ignoreBOM: true })

const sameBytes = (a: Read | undefined, b: Read | undefined): boolean => {
  if (!a || !b) return a === b
  if (!a.whole || !b.whole || a.size !== b.size) return false
  return Buffer.from(a.bytes.buffer, a.bytes.byteOffset, a.bytes.length).equals(b.bytes)
}

/** One side of a binary: its size, and what its header says if it is an image. */
const sideOf = (read: Read | undefined): BinarySide | undefined => {
  if (!read) return undefined
  const image = sniff(read.bytes)
  return { size: read.size, ...(image ? { image } : {}) }
}

/**
 * Both sides read, one file decided: text, binary, too large, or unchanged.
 *
 * Binary is decided once, for the pair — a file that became binary, or stopped being, is not a text
 * diff on either side.
 */
export function decide(
  path: string,
  before: Read | undefined,
  after: Read | undefined,
  change: FileChange["change"],
  from: string | undefined,
  revision: string,
): { file?: FileChange; error?: string } {
  if (sameBytes(before, after) && change !== "renamed") return {}
  if ((before && looksBinary(before.bytes)) || (after && looksBinary(after.bytes))) {
    const sides = { before: sideOf(before), after: sideOf(after) }
    return {
      file: {
        ...fileOf(path, "", "", change, from),
        binary: {
          ...(sides.before ? { before: sides.before } : {}),
          ...(sides.after ? { after: sides.after } : {}),
          ...(before ? { revision } : {}),
        },
      },
    }
  }
  if ((after && !after.whole) || (after && after.size > MAX_BYTES) || (before && !before.whole))
    return { error: `${path}: too large to review here` }
  return {
    file: fileOf(
      path,
      before ? decoder.decode(before.bytes) : "",
      after ? decoder.decode(after.bytes) : "",
      change,
      from,
    ),
  }
}

/** What a two-letter `git status` code says happened to the file itself. */
export function statusChange(code: string, from: string | undefined): FileChange["change"] {
  if (/[RC]/.test(code)) return from && code.includes("R") ? "renamed" : "added"
  if (code.includes("?") || code.includes("A")) return "added"
  if (code.includes("D")) return "deleted"
  return undefined
}

/** One file, with its change and where it came from only when there is something to say. */
const fileOf = (
  path: string,
  before: string,
  after: string,
  change: FileChange["change"],
  from: string | undefined,
): FileChange => ({
  path,
  before,
  after,
  additions: 0,
  deletions: 0,
  ...(change ? { change } : {}),
  ...(change === "renamed" && from ? { from } : {}),
})

/**
 * `git diff --name-status -z` as path → what happened to it.
 *
 * Each record is a status, then one path — or two, old then new, for a rename or a copy. A rename
 * matters most: without it the old path read as deleted and the new one as created, and the
 * reviewer read the whole file twice to find the line that changed.
 */
export function nameStatus(out: string): Map<string, { change: FileChange["change"]; from?: string }> {
  const found = new Map<string, { change: FileChange["change"]; from?: string }>()
  const fields = out.split("\0")
  let index = 0
  while (index < fields.length) {
    const code = fields[index++] ?? ""
    if (!code) continue
    if (code.startsWith("R") || code.startsWith("C")) {
      const from = fields[index++] ?? ""
      const path = fields[index++] ?? ""
      if (path) found.set(path, code.startsWith("R") ? { change: "renamed", from } : { change: "added" })
      continue
    }
    const path = fields[index++] ?? ""
    if (!path) continue
    found.set(path, { change: code.startsWith("A") ? "added" : code.startsWith("D") ? "deleted" : undefined })
  }
  return found
}

/** A branch this one could be compared against, and how far apart the two are. */
export interface BaseCandidate {
  ref: string
  /** Commits on HEAD that `ref` lacks — what a pull request into `ref` would carry. */
  own: number
  /** Commits on `ref` that HEAD lacks — how far `ref` has moved on since the fork. */
  other: number
}

/** The names a repository's main line usually goes by: what a branch is compared with when nothing nearer is found. */
export const USUAL_BASES = ["main", "master", "origin/main", "origin/master"]

/**
 * The branch this one most likely targets: the nearest parent.
 *
 * On `main ← feature ← X`, comparing X with `main` also shows every commit of `feature` — the
 * "everything mixed together" a stacked branch got before. The nearest parent is the one X has the
 * fewest commits beyond, which is `feature`, and a PR from X into `feature` shows exactly that.
 * The same rule drops a stale local `main` for a fresher `origin/main` without special-casing it.
 */
export function pickBase(candidates: readonly BaseCandidate[], preferred?: string): string | undefined {
  const usual = (ref: string) => {
    if (preferred && (ref === preferred || ref.endsWith(`/${preferred}`))) return 0
    return USUAL_BASES.includes(ref) ? 1 : 2
  }
  const ranked = [...candidates].sort(
    (a, b) =>
      a.own - b.own ||
      // Two bases at the same fork point give the same diff; the one a PR would target reads best.
      usual(a.ref) - usual(b.ref) ||
      // Then local over remote, so the label says `feature` rather than `origin/feature`.
      Number(a.ref.includes("/")) - Number(b.ref.includes("/")) ||
      a.other - b.other,
  )
  return ranked[0]?.ref
}

/**
 * Fill in each file's counts from the same diff the pane will draw. Git could report them, but two
 * sources for one number is how a list ends up saying +12 above a hunk showing eleven lines.
 */
export function withCounts(files: readonly FileChange[]): FileChange[] {
  /** A binary has no lines to count; its card says what changed instead. */
  return files.map((file) =>
    file.binary ? file : { ...file, ...countChanges(diffLines(file.before, file.after)) },
  )
}
