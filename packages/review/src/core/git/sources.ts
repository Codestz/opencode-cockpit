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

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { countChanges, diffLines } from "../diff/hunks.ts"
import type { FileChange } from "../model/review.ts"

export interface GitResult {
  files: FileChange[]
  /** What could not be read, phrased for a person: shown rather than swallowed. */
  errors: string[]
  /** For branch mode: what it compared against. */
  base?: string
}

/** More than this and the pane is not the right tool — and reading them all would stall the TUI. */
const MAX_FILES = 200
/** A file bigger than this is almost certainly not being read line by line. */
const MAX_BYTES = 400_000

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

/** A file's contents at a revision, or "" when it did not exist there — which is what a diff wants. */
async function show(git: RunGit, cwd: string, revision: string, path: string): Promise<string> {
  const result = await git(["show", `${revision}:${path}`], cwd)
  return result.ok ? result.out : ""
}

function readWorking(cwd: string, path: string): { text: string; error?: string } {
  try {
    const full = join(cwd, path)
    const file = Bun.file(full)
    if (file.size > MAX_BYTES) return { text: "", error: `${path}: too large to review here` }
    return { text: readFileSync(full, "utf8") }
  } catch {
    // Deleted from the working tree: an empty "after" is exactly right.
    return { text: "" }
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
  for (const entry of status.out.split("\0")) {
    if (entry.length < 4) continue
    const code = entry.slice(0, 2)
    const path = entry.slice(3)
    if (files.length >= MAX_FILES) {
      errors.push(`more than ${MAX_FILES} files changed; showing the first ${MAX_FILES}`)
      break
    }
    // A rename's "-z" form puts the old path in the next entry; the new path is what we read.
    const before = code.includes("?") ? "" : await show(git, cwd, "HEAD", path)
    const { text: after, error } = readWorking(cwd, path)
    if (error) {
      errors.push(error)
      continue
    }
    if (before === after) continue
    files.push({ path, before, after, additions: 0, deletions: 0 })
  }
  return { files, errors }
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

  const listed = await git(["diff", "--name-only", "-z", fork], cwd)
  if (!listed.ok) return { files: [], errors: ["could not list the branch's changes"], base: against }

  /**
   * Untracked files count as part of the branch.
   *
   * `git diff` cannot see a file git has never been told about, and a file the agent created a
   * minute ago is the one you most want to read — leaving it out makes branch mode quietly wrong
   * in exactly the case this bay exists for.
   */
  const untracked = await git(["ls-files", "--others", "--exclude-standard", "-z"], cwd)
  const paths = [...listed.out.split("\0"), ...(untracked.ok ? untracked.out.split("\0") : [])].filter(
    (path, index, all) => path && all.indexOf(path) === index,
  )

  const files: FileChange[] = []
  const errors: string[] = []
  for (const path of paths) {
    if (!path) continue
    if (files.length >= MAX_FILES) {
      errors.push(`more than ${MAX_FILES} files changed; showing the first ${MAX_FILES}`)
      break
    }
    const before = await show(git, cwd, fork, path)
    const { text: after, error } = readWorking(cwd, path)
    if (error) {
      errors.push(error)
      continue
    }
    if (before === after) continue
    files.push({ path, before, after, additions: 0, deletions: 0 })
  }
  return { files, errors, base: against }
}

/**
 * Fill in each file's counts from the same diff the pane will draw. Git could report them, but two
 * sources for one number is how a list ends up saying +12 above a hunk showing eleven lines.
 */
export function withCounts(files: readonly FileChange[]): FileChange[] {
  return files.map((file) => ({ ...file, ...countChanges(diffLines(file.before, file.after)) }))
}
