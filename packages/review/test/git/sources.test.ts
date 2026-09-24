import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  baseCandidates,
  branchChanges,
  pickBase,
  runGit,
  withCounts,
  worktreeChanges,
} from "../../src/core/git/sources.ts"

/**
 * Driven against a real repository rather than a fake one.
 *
 * Everything worth getting wrong here is git's own behaviour — that `git diff` cannot see an
 * untracked file, that a deleted file still has a "before", that `--porcelain` codes differ between
 * staged and unstaged — and a mock would simply agree with whatever this code already believed.
 */

let repo: string

const git = async (...args: string[]) => {
  const result = await runGit(args, repo)
  if (!result.ok) throw new Error(`git ${args.join(" ")} failed`)
  return result.out
}
const write = (path: string, text: string) => {
  const full = join(repo, path)
  mkdirSync(join(full, ".."), { recursive: true })
  writeFileSync(full, text)
}
const paths = (files: readonly { path: string }[]) => files.map((file) => file.path).sort()

beforeAll(async () => {
  repo = mkdtempSync(join(tmpdir(), "ck-review-git-"))
  await git("init", "--initial-branch=main")
  await git("config", "user.email", "test@example.com")
  await git("config", "user.name", "Test")
  write("kept.ts", "one\ntwo\nthree\n")
  write("removed.ts", "gone\n")
  write("nested/deep.ts", "deep\n")
  await git("add", "-A")
  await git("commit", "-m", "first")
})

afterAll(() => rmSync(repo, { recursive: true, force: true }))

describe("uncommitted work", () => {
  test("a clean tree has nothing to review", async () => {
    expect((await worktreeChanges(repo)).files).toEqual([])
  })

  test("an edited file carries both sides", async () => {
    write("kept.ts", "one\nTWO\nthree\n")
    const [file] = (await worktreeChanges(repo)).files
    expect(file?.path).toBe("kept.ts")
    expect(file?.before).toBe("one\ntwo\nthree\n")
    expect(file?.after).toBe("one\nTWO\nthree\n")
  })

  /** The file the agent just wrote: invisible to `git diff`, and the one you most want to read. */
  test("an untracked file is included, with an empty before", async () => {
    write("brand-new.ts", "fresh\n")
    const found = (await worktreeChanges(repo)).files.find((file) => file.path === "brand-new.ts")
    expect(found?.before).toBe("")
    expect(found?.after).toBe("fresh\n")
  })

  test("a deleted file keeps its before and has nothing after", async () => {
    rmSync(join(repo, "removed.ts"))
    const found = (await worktreeChanges(repo)).files.find((file) => file.path === "removed.ts")
    expect(found?.before).toBe("gone\n")
    expect(found?.after).toBe("")
  })

  test("a staged change is still uncommitted work", async () => {
    await git("add", "kept.ts")
    expect(paths((await worktreeChanges(repo)).files)).toContain("kept.ts")
  })

  test("a nested path comes back whole", async () => {
    write("nested/deep.ts", "deeper\n")
    expect(paths((await worktreeChanges(repo)).files)).toContain("nested/deep.ts")
  })

  test("a directory that is not a repository says so instead of throwing", async () => {
    const empty = mkdtempSync(join(tmpdir(), "ck-review-nogit-"))
    try {
      const result = await worktreeChanges(empty)
      expect(result.files).toEqual([])
      expect(result.errors[0]).toContain("not a git repository")
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })
})

describe("the branch", () => {
  beforeAll(async () => {
    await git("add", "-A")
    await git("commit", "-m", "work in progress")
    await git("checkout", "-q", "-b", "feature")
    write("on-branch.ts", "branch work\n")
    await git("add", "-A")
    await git("commit", "-m", "on the branch")
    write("uncommitted-too.ts", "not committed\n")
  })

  test("carries what was committed on the branch", async () => {
    const result = await branchChanges(repo)
    expect(paths(result.files)).toContain("on-branch.ts")
    expect(result.base).toBe("main")
  })

  /** Committed and uncommitted together: what a reviewer would see, not what is staged right now. */
  test("carries uncommitted work as well, tracked or not", async () => {
    expect(paths((await branchChanges(repo)).files)).toContain("uncommitted-too.ts")
  })

  test("nothing on the branch yet is nothing to review", async () => {
    await git("checkout", "-q", "main")
    const result = await branchChanges(repo)
    // Only the untracked file from the feature branch survives the checkout.
    expect(result.files.every((file) => file.path === "uncommitted-too.ts")).toBe(true)
    await git("checkout", "-q", "feature")
  })

  test("a base that does not exist is reported rather than guessed at", async () => {
    const result = await branchChanges(repo, "no-such-branch")
    expect(result.files).toEqual([])
    expect(result.errors[0]).toContain("no base branch")
  })
})

/** main ← feature ← stacked: the case that used to show feature's commits as stacked's own. */
describe("a stacked branch", () => {
  beforeAll(async () => {
    await git("add", "-A")
    await git("commit", "-m", "finish feature")
    await git("checkout", "-q", "-b", "stacked")
    write("stacked-only.ts", "stacked work\n")
    await git("add", "-A")
    await git("commit", "-m", "on the stack")
  })

  afterAll(async () => {
    await git("checkout", "-q", "feature")
  })

  test("is compared with the branch it grew from, not the default one", async () => {
    const result = await branchChanges(repo, undefined, runGit, "main")
    expect(result.base).toBe("feature")
    expect(paths(result.files)).toEqual(["stacked-only.ts"])
  })

  test("a branch stacked on top of this one is a child, never the parent", async () => {
    await git("checkout", "-q", "-b", "grandchild")
    write("grandchild.ts", "deeper\n")
    await git("add", "-A")
    await git("commit", "-m", "on the grandchild")
    await git("checkout", "-q", "stacked")
    const candidates = await baseCandidates(repo)
    expect(candidates.map((each) => each.ref)).not.toContain("grandchild")
    expect(pickBase(candidates, "main")).toBe("feature")
  })

  test("an explicit base still wins, for the whole stack at once", async () => {
    const result = await branchChanges(repo, "main")
    expect(result.base).toBe("main")
    expect(paths(result.files)).toEqual(expect.arrayContaining(["on-branch.ts", "stacked-only.ts"]))
  })
})

describe("choosing a base", () => {
  test("the nearest fork wins, then the default branch, then local over remote", () => {
    expect(
      pickBase(
        [
          { ref: "main", own: 5, other: 0 },
          { ref: "feature", own: 2, other: 1 },
        ],
        "main",
      ),
    ).toBe("feature")
    expect(
      pickBase(
        [
          { ref: "sibling", own: 3, other: 4 },
          { ref: "origin/main", own: 3, other: 9 },
          { ref: "main", own: 3, other: 0 },
        ],
        "main",
      ),
    ).toBe("main")
  })

  /** Local `main` left behind while `origin/main` moved on: the fresher one is the nearer fork. */
  test("a stale local default loses to its fresher remote", () => {
    expect(
      pickBase(
        [
          { ref: "main", own: 12, other: 0 },
          { ref: "origin/main", own: 2, other: 0 },
        ],
        "main",
      ),
    ).toBe("origin/main")
  })
})

describe("counts", () => {
  test("come from the same diff the pane draws, so they cannot disagree with it", async () => {
    const counted = withCounts([
      { path: "x.ts", before: "a\nb\n", after: "a\nB\nc\n", additions: 999, deletions: 999 },
    ])
    expect(counted[0]).toMatchObject({ additions: 2, deletions: 1 })
  })

  test("a new file is all additions", async () => {
    const counted = withCounts([{ path: "x.ts", before: "", after: "a\nb\n", additions: 0, deletions: 0 }])
    expect(counted[0]).toMatchObject({ additions: 2, deletions: 0 })
  })
})
