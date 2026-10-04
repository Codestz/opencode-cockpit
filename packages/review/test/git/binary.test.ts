import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { withCounts } from "../../src/core/git/changes.ts"
import { branchChanges, readBlob, runGit, worktreeChanges } from "../../src/io/git.ts"

/**
 * Binaries through a real repository: what git hands over, read as bytes.
 *
 * The bug this guards: images were read as UTF-8 — a PNG under 400 KB became a "+412 −268" diff of
 * U+FFFD, and one over it was skipped with "too large", silently absent from the review.
 */

let repo: string
const fixtures = join(import.meta.dir, "..", "image", "fixtures")

const git = async (...args: string[]) => {
  const result = await runGit(args, repo)
  if (!result.ok) throw new Error(`git ${args.join(" ")} failed`)
  return result.out
}
const put = (fixture: string, path: string) => copyFileSync(join(fixtures, fixture), join(repo, path))
/** A PNG's signature and IHDR in front of 600 KB of noise: over the text cap, under the binary one. */
const bigPng = (seed: number) => {
  const noise = new Uint8Array(600_000)
  for (let index = 0; index < noise.length; index++) noise[index] = (index * 7919 + seed) & 255
  return Buffer.concat([readFileSync(join(fixtures, "before.png")).subarray(0, 33), noise])
}

beforeAll(async () => {
  repo = mkdtempSync(join(tmpdir(), "ck-review-binary-"))
  await git("init", "--initial-branch=main")
  await git("config", "user.email", "test@example.com")
  await git("config", "user.name", "Test")
  put("before.png", "shot.png")
  put("still.gif", "gone.gif")
  put("blob.bin", "data.bin")
  put("baseline.jpg", "photo.jpg")
  writeFileSync(join(repo, "big.png"), bigPng(1))
  writeFileSync(join(repo, "notes.txt"), "one\ntwo\n")
  await git("add", "-A")
  await git("commit", "-m", "first")
  await git("checkout", "-b", "feature")
})

afterAll(() => rmSync(repo, { recursive: true, force: true }))

describe("uncommitted binaries", () => {
  test("a changed PNG is a binary change with both headers, not a text diff", async () => {
    put("after.png", "shot.png")
    const files = withCounts((await worktreeChanges(repo)).files)
    const shot = files.find((file) => file.path === "shot.png")
    expect(shot?.before).toBe("")
    expect(shot?.after).toBe("")
    expect([shot?.additions, shot?.deletions]).toEqual([0, 0])
    expect(shot?.binary?.before?.image).toEqual({ format: "png", width: 64, height: 40 })
    expect(shot?.binary?.after?.image).toEqual({ format: "png", width: 64, height: 40 })
    expect(shot?.binary?.before?.size).toBe(278)
    expect(shot?.binary?.after?.size).toBe(300)
    expect(shot?.binary?.revision).toBe("HEAD")
  })

  test("over the text cap, an image is still in the review — described, not skipped", async () => {
    writeFileSync(join(repo, "big.png"), bigPng(2))
    const result = await worktreeChanges(repo)
    expect(result.errors.join(" ")).not.toContain("big.png")
    const big = result.files.find((file) => file.path === "big.png")
    expect(big?.binary?.after?.size).toBe(600_033)
    expect(big?.binary?.after?.image).toMatchObject({ format: "png", width: 64, height: 40 })
  })

  test("added, deleted, a JPEG, and a binary that is no image", async () => {
    put("anim.gif", "new.gif")
    rmSync(join(repo, "gone.gif"))
    put("progressive.jpg", "photo.jpg")
    writeFileSync(join(repo, "data.bin"), Buffer.concat([Buffer.from([0, 1, 2]), Buffer.alloc(5000, 9)]))
    const files = (await worktreeChanges(repo)).files
    const by = (path: string) => files.find((file) => file.path === path)
    expect(by("new.gif")?.change).toBe("added")
    expect(by("new.gif")?.binary).toEqual({
      after: { size: 594, image: { format: "gif", width: 64, height: 40 } },
    })
    expect(by("gone.gif")?.change).toBe("deleted")
    expect(by("gone.gif")?.binary?.after).toBeUndefined()
    expect(by("gone.gif")?.binary?.before?.image?.format).toBe("gif")
    expect(by("photo.jpg")?.binary?.after?.image).toEqual({ format: "jpeg", width: 64, height: 40 })
    expect(by("data.bin")?.binary?.before).toEqual({ size: 1028 })
    expect(by("data.bin")?.binary?.after).toEqual({ size: 5003 })
  })

  test("text stays text", async () => {
    writeFileSync(join(repo, "notes.txt"), "one\nTWO\n")
    const notes = (await worktreeChanges(repo)).files.find((file) => file.path === "notes.txt")
    expect(notes?.binary).toBeUndefined()
    expect(notes?.after).toBe("one\nTWO\n")
  })
})

describe("branch binaries", () => {
  test("committed on the branch, read against the fork point", async () => {
    await git("add", "-A")
    await git("commit", "-m", "second")
    const result = await branchChanges(repo, "main")
    const shot = result.files.find((file) => file.path === "shot.png")
    expect(shot?.binary?.after?.size).toBe(300)
    /** The fork point's id, so the old bytes can be read again — by `o`, by the pixel diff. */
    expect(shot?.binary?.revision).toMatch(/^[0-9a-f]{40}$/)
  })
})

describe("reading a blob as bytes", () => {
  test("whole, and byte for byte what was committed", async () => {
    const read = await readBlob(repo, "main", "shot.png")
    expect(read?.whole).toBe(true)
    expect(Buffer.from(read?.bytes ?? []).equals(readFileSync(join(fixtures, "before.png")))).toBe(true)
  })

  test("past the cap: the head, the true size, and no more", async () => {
    const read = await readBlob(repo, "main", "big.png", 4096)
    expect(read?.whole).toBe(false)
    expect(read?.size).toBe(600_033)
    expect(read?.bytes.length).toBeLessThanOrEqual(64 * 1024)
  })

  test("not there: nothing", async () => {
    expect(await readBlob(repo, "main", "no-such-file.png")).toBeUndefined()
  })
})
