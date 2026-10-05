import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { toHunks } from "../../src/core/diff/hunks.ts"
import { withCounts } from "../../src/core/git/changes.ts"
import type { FileChange } from "../../src/core/model/review.ts"
import { hunkWhitespace } from "../../src/core/view/whitespace.ts"
import { branchChanges, runGit, worktreeChanges } from "../../src/io/git.ts"

/**
 * What happened to each file itself — created, deleted, moved — as git reports it, against a real
 * repository. A rename is the one a mock would get right by accident and git gets right on purpose:
 * `--porcelain -z` puts the old path in an entry of its own, and `--name-status -z` puts it first.
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
const find = (files: readonly FileChange[], path: string) => files.find((file) => file.path === path)

/** Long enough that a one-line edit still reads as the same file to git's rename detection. */
const BODY = Array.from({ length: 30 }, (_, index) => `export const line${index} = ${index}`).join("\n")

beforeAll(async () => {
  repo = mkdtempSync(join(tmpdir(), "ck-review-kinds-"))
  await git("init", "--initial-branch=main")
  await git("config", "user.email", "test@example.com")
  await git("config", "user.name", "Test")
  write("src/config/load.ts", `${BODY}\n`)
  write("src/old/legacy.ts", "gone soon\n")
  write("src/spacing.ts", "const a = 1\n")
  write("src/plain.ts", "one\n")
  await git("add", "-A")
  await git("commit", "-m", "first")
})

afterAll(() => rmSync(repo, { recursive: true, force: true }))

describe("uncommitted work says what happened to each file", () => {
  beforeAll(async () => {
    mkdirSync(join(repo, "src/core"), { recursive: true })
    await git("mv", "src/config/load.ts", "src/core/settings.ts")
    write("src/core/settings.ts", `${BODY.replace("line3 = 3", "line3 = 33")}\n`)
    await git("add", "src/core/settings.ts")
    await git("rm", "-q", "src/old/legacy.ts")
    write("src/core/notices.ts", "fresh\n")
    write("src/plain.ts", "two\n")
    write("src/spacing.ts", "const a = 1 \n")
  })

  test("a moved file is renamed, from where it was, and its diff is the edit alone", async () => {
    const files = withCounts((await worktreeChanges(repo)).files)
    const moved = find(files, "src/core/settings.ts")
    expect(moved).toMatchObject({ change: "renamed", from: "src/config/load.ts", additions: 1, deletions: 1 })
    /** The old path was once read as a file of its own, named by whatever followed its first characters. */
    expect(files.map((file) => file.path)).not.toContain("src/config/load.ts")
    expect(files.some((file) => file.path.endsWith("onfig/load.ts"))).toBe(false)
  })

  test("a new file is added, a deleted one deleted, and an edit says nothing", async () => {
    const files = (await worktreeChanges(repo)).files
    expect(find(files, "src/core/notices.ts")?.change).toBe("added")
    expect(find(files, "src/old/legacy.ts")?.change).toBe("deleted")
    expect(find(files, "src/plain.ts")?.change).toBeUndefined()
  })

  test("a whitespace-only change is kept, and its hunk is whitespace only", async () => {
    const spacing = find((await worktreeChanges(repo)).files, "src/spacing.ts")
    expect(spacing).toBeDefined()
    const [hunk] = toHunks(spacing?.before ?? "", spacing?.after ?? "")
    expect(hunk && hunkWhitespace(hunk).only).toBe(true)
  })

  test("a file moved and not touched is still in the review", async () => {
    await git("mv", "src/plain.ts", "src/still.ts")
    await git("checkout", "-q", "--", ".")
    const files = (await worktreeChanges(repo)).files
    await git("mv", "src/still.ts", "src/plain.ts")
    expect(find(files, "src/still.ts")).toMatchObject({ change: "renamed", from: "src/plain.ts" })
  })
})

describe("the branch says what happened to each file", () => {
  beforeAll(async () => {
    await git("checkout", "-q", "-b", "feature")
    await git("add", "-A")
    await git("commit", "-q", "-m", "moves, a deletion, a new file")
    write("src/untracked.ts", "not yet added\n")
  })

  test("renamed, added, deleted and edited, committed and not", async () => {
    const result = await branchChanges(repo, "main")
    const files = withCounts(result.files)
    expect(find(files, "src/core/settings.ts")).toMatchObject({
      change: "renamed",
      from: "src/config/load.ts",
      additions: 1,
      deletions: 1,
    })
    expect(files.map((file) => file.path)).not.toContain("src/config/load.ts")
    expect(find(files, "src/core/notices.ts")?.change).toBe("added")
    expect(find(files, "src/old/legacy.ts")).toMatchObject({ change: "deleted", after: "" })
    expect(find(files, "src/untracked.ts")?.change).toBe("added")
    expect(find(files, "src/spacing.ts")?.change).toBeUndefined()
  })
})
