/**
 * Changes git knows about, for the two sources a conversation cannot supply.
 *
 * `session.diff` only covers files *this conversation* edited, which is the right default and is
 * empty most of the time you want to look at something — you open a new conversation about work
 * that already exists, and the pane has nothing to show. These are the other two questions a
 * reviewer asks: what have I not committed, and what does this branch change.
 *
 * Everything here is a plain function of `git` output so it can be driven from a test with a real
 * repository, rather than mocked into agreeing with itself.
 */

import { join } from "node:path"
import { countChanges, diffLines } from "../diff/hunks.ts"
import { HEADER_BYTES, looksBinary, sniff } from "../image/sniff.ts"
import type { BinarySide, FileChange } from "../model/review.ts"

export interface GitResult {
  files: FileChange[]
  /** What could not be read, phrased for a person: shown rather than swallowed. */
  errors: string[]
  /** For branch mode: what it compared against. */
  base?: string
}

/** More than this and the pane is not the right tool — and reading them all would stall the TUI. */
const MAX_FILES = 200
/** A text file bigger than this is almost certainly not being read line by line. */
const MAX_BYTES = 400_000
/**
 * A binary is read whole up to this — its own cap, far above the text one.
 *
 * Every real screenshot is over 400 KB, and under the text cap each one was skipped with "too large
 * to review here": the file most worth a look silently was not in the review. Past this the header
 * is still read, so the file is still named, sized and described.
 */
export const MAX_BINARY_BYTES = 32 * 1024 * 1024

export type RunGit = (args: string[], cwd: string) => Promise<{ ok: boolean; out: string }>

/**
 * The default runner, asynchronous on purpose.
 *
 * The TUI is a worker thread, and `Bun.spawnSync` there takes the renderer down with it — the pane
 * drew perfectly until the first key that needed git, then the whole interface stopped. Nothing on
 * the draw path may block, and git is never on it: these run when the source changes, not per frame.
 */
export const runGit: RunGit = async (args, cwd) => {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "ignore" })
  const out = await new Response(proc.stdout).text()
  return { ok: (await proc.exited) === 0, out }
}

/**
 * The commit a review is being written against, short form, or nothing outside a repository.
 *
 * Recorded on a thread as provenance — never as its anchor. A comment is found again by the lines it
 * quoted, because those survive being committed, and a commit id does not.
 */
export async function headOf(cwd: string, git: RunGit = runGit): Promise<string | undefined> {
  const result = await git(["rev-parse", "--short", "HEAD"], cwd)
  const head = result.out.trim()
  return result.ok && head.length > 0 ? head : undefined
}

/** Some or all of a file's bytes, and how many there are in all. */
export interface Read {
  bytes: Uint8Array
  size: number
  /** False when only the first bytes were read, the file being over the cap. */
  whole: boolean
}

const joined = (chunks: readonly Uint8Array[], total: number): Uint8Array => {
  if (chunks.length === 1) return chunks[0] as Uint8Array
  const out = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

/**
 * A file as git has it at a revision, as **bytes** — or undefined when it did not exist there.
 *
 * Read as text, git's output went through UTF-8 and a 91 KB PNG came out as 166 KB of something else:
 * the bytes were gone, not merely ugly. `cat-file blob` rather than `show`, so nothing (a textconv, a
 * pager) stands between the blob and what is read. Past `cap` the stream is cut and only the size is
 * asked for — a 200 MB asset is described, never held.
 */
export async function readBlob(
  cwd: string,
  revision: string,
  path: string,
  cap = MAX_BINARY_BYTES,
): Promise<Read | undefined> {
  const proc = Bun.spawn(["git", "cat-file", "blob", `${revision}:${path}`], {
    cwd,
    stdout: "pipe",
    stderr: "ignore",
  })
  const reader = proc.stdout.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  let over = false
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.length
    if (total > cap) {
      over = true
      break
    }
  }
  if (over) {
    await reader.cancel().catch(() => {})
    proc.kill()
    await proc.exited
    const sized = await runGit(["cat-file", "-s", `${revision}:${path}`], cwd)
    const size = Number(sized.out.trim())
    return {
      bytes: joined(chunks, total).subarray(0, HEADER_BYTES),
      size: sized.ok && Number.isFinite(size) ? size : total,
      whole: false,
    }
  }
  if ((await proc.exited) !== 0) return undefined
  return { bytes: joined(chunks, total), size: total, whole: true }
}

/**
 * The working copy's bytes, or undefined when it is not there (deleted: an empty "after" is right).
 *
 * A file over the text cap is read in full only when its first bytes say it is binary and it is under
 * the binary cap; otherwise its head is enough to say what it is.
 */
export async function readWorking(cwd: string, path: string): Promise<Read | undefined> {
  try {
    const file = Bun.file(join(cwd, path))
    const size = file.size
    if (size > MAX_BYTES) {
      const head = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer())
      if (!looksBinary(head) || size > MAX_BINARY_BYTES) return { bytes: head, size, whole: false }
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    return { bytes, size: bytes.length, whole: true }
  } catch {
    return undefined
  }
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

/**
 * Uncommitted work: everything `git status` reports, including files git has never seen.
 *
 * Untracked files matter here more than in most tools — a new file an agent just wrote is the thing
 * you most want to read, and it is precisely what a plain `git diff` leaves out.
 */
export async function worktreeChanges(cwd: string, git: RunGit = runGit): Promise<GitResult> {
  const status = await git(["status", "--porcelain=v1", "-z", "--untracked-files=all"], cwd)
  if (!status.ok) return { files: [], errors: ["not a git repository"] }

  const files: FileChange[] = []
  const errors: string[] = []
  // NUL-separated so paths with spaces or quotes need no unescaping.
  const entries = status.out.split("\0")
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index] as string
    if (entry.length < 4) continue
    const code = entry.slice(0, 2)
    const path = entry.slice(3)
    /**
     * A rename's "-z" form puts the old path in the next entry, with no code of its own. Read as an
     * entry, it became a file called whatever followed its first three characters.
     */
    const from = /[RC]/.test(code) ? entries[++index] : undefined
    if (files.length >= MAX_FILES) {
      errors.push(`more than ${MAX_FILES} files changed; showing the first ${MAX_FILES}`)
      break
    }
    const change = statusChange(code, from)
    const before =
      code.includes("?") || code.includes("C") ? undefined : await readBlob(cwd, "HEAD", from ?? path)
    const { file, error } = decide(path, before, await readWorking(cwd, path), change, from, "HEAD")
    if (error) errors.push(error)
    if (file) files.push(file)
  }
  return { files, errors }
}

/** What a two-letter `git status` code says happened to the file itself. */
function statusChange(code: string, from: string | undefined): FileChange["change"] {
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
function nameStatus(out: string): Map<string, { change: FileChange["change"]; from?: string }> {
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

/** Enough to cover every branch anyone is stacking on, few enough to stay one quick burst of git. */
const MAX_CANDIDATES = 60
const USUAL_BASES = ["main", "master", "origin/main", "origin/master"]

/**
 * Every branch HEAD could have come from, measured.
 *
 * Excluded: HEAD's own branch, its upstream and any `<remote>/<same name>` (comparing a branch to
 * its pushed self is not a review), and anything that already contains HEAD — a branch stacked *on*
 * this one, or a second name for this commit, is a child, never a parent.
 */
export async function baseCandidates(cwd: string, git: RunGit = runGit): Promise<BaseCandidate[]> {
  const [current, upstream, refs] = await Promise.all([
    git(["symbolic-ref", "--short", "-q", "HEAD"], cwd),
    git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], cwd),
    git(
      [
        "for-each-ref",
        "--no-contains=HEAD",
        "--sort=-committerdate",
        "--format=%(refname:short)%00%(symref)",
        "refs/heads",
        "refs/remotes",
      ],
      cwd,
    ),
  ])
  if (!refs.ok) return []
  const here = current.ok ? current.out.trim() : ""
  const pushed = upstream.ok ? upstream.out.trim() : ""
  const names = refs.out
    .split("\n")
    .map((line) => line.split("\0"))
    .filter(([name, symref]) => name && !symref)
    .map(([name]) => name as string)
    .filter((name) => name !== here && name !== pushed && !(here && name.endsWith(`/${here}`)))
    .slice(0, MAX_CANDIDATES)

  const measured = await Promise.all(
    names.map(async (ref): Promise<BaseCandidate | undefined> => {
      const counted = await git(["rev-list", "--left-right", "--count", `${ref}...HEAD`], cwd)
      const [other, own] = counted.out.trim().split(/\s+/).map(Number)
      if (!counted.ok || own === undefined || other === undefined) return undefined
      if (Number.isNaN(own) || Number.isNaN(other)) return undefined
      return { ref, own, other }
    }),
  )
  return measured.filter((each): each is BaseCandidate => each !== undefined)
}

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
 * Whether HEAD is the branch everything else targets.
 *
 * There the nearest-parent search has nothing sensible to find — every old branch merged into
 * `main` is an ancestor of it and would be "nearest" — so the answer is `main` itself.
 */
async function onDefault(cwd: string, git: RunGit, preferred?: string): Promise<boolean> {
  const current = await git(["symbolic-ref", "--short", "-q", "HEAD"], cwd)
  const here = current.ok ? current.out.trim() : ""
  return here !== "" && (here === preferred || USUAL_BASES.includes(here))
}

/**
 * Everything this branch changes, against where it forked — what a reviewer on a pull request
 * reads, rather than what happens to be uncommitted right now. Committed work included.
 *
 * `base` is an explicit choice and is used as given; without one the nearest parent is found, with
 * `preferred` (the repository's default branch) winning ties.
 */
export async function branchChanges(
  cwd: string,
  base?: string,
  git: RunGit = runGit,
  preferred?: string,
): Promise<GitResult> {
  const nearest =
    base || (await onDefault(cwd, git, preferred))
      ? undefined
      : pickBase(await baseCandidates(cwd, git), preferred)
  // Nothing measurable — on the default branch itself, say — falls back to the usual names, where
  // the merge-base is HEAD and only uncommitted work shows.
  const candidates = base ? [base] : nearest ? [nearest] : [...(preferred ? [preferred] : []), ...USUAL_BASES]
  let fork: string | undefined
  let against: string | undefined
  for (const candidate of candidates) {
    const result = await git(["merge-base", candidate, "HEAD"], cwd)
    if (result.ok && result.out.trim()) {
      fork = result.out.trim()
      against = candidate
      break
    }
  }
  if (!fork)
    return { files: [], errors: [base ? `no base branch "${base}"` : "no base branch to compare against"] }

  const listed = await git(["diff", "--name-status", "-z", "-M", fork], cwd)
  if (!listed.ok) return { files: [], errors: ["could not list the branch's changes"], base: against }
  const changed = nameStatus(listed.out)

  /**
   * Untracked files count as part of the branch.
   *
   * `git diff` cannot see a file git has never been told about, and a file the agent created a
   * minute ago is the one you most want to read — leaving it out makes branch mode quietly wrong
   * in exactly the case this bay exists for.
   */
  const untracked = await git(["ls-files", "--others", "--exclude-standard", "-z"], cwd)
  const fresh = untracked.ok ? untracked.out.split("\0").filter(Boolean) : []
  for (const path of fresh) if (!changed.has(path)) changed.set(path, { change: "added" })
  const paths = [...changed.keys()]

  const files: FileChange[] = []
  const errors: string[] = []
  for (const path of paths) {
    if (!path) continue
    if (files.length >= MAX_FILES) {
      errors.push(`more than ${MAX_FILES} files changed; showing the first ${MAX_FILES}`)
      break
    }
    const { change, from } = changed.get(path) ?? { change: undefined }
    const before = change === "added" ? undefined : await readBlob(cwd, fork, from ?? path)
    const { file, error } = decide(path, before, await readWorking(cwd, path), change, from, fork)
    if (error) errors.push(error)
    if (file) files.push(file)
  }
  return { files, errors, base: against }
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
