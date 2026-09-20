import { describe, expect, test } from "bun:test"
import { projectSlug, reviewPaths, slug } from "../../src/core/store/paths.ts"

const env = { XDG_DATA_HOME: "/data" }

describe("naming a review's directory", () => {
  test("a branch with slashes becomes one safe name", () => {
    expect(slug("feat/review-bay")).toBe("feat-review-bay")
  })

  /** A branch name is user input, and this is building a path out of it. */
  test("nothing can walk out of the directory it was meant to name", () => {
    expect(slug("../../etc/passwd")).not.toContain("/")
    expect(slug("../../etc/passwd")).not.toContain("..")
    expect(slug("..")).toBe("unnamed")
  })

  test("a name of nothing but punctuation still names something", () => {
    expect(slug("///")).toBe("unnamed")
    expect(slug("")).toBe("unnamed")
  })

  test("absurdly long names are cut, not rejected", () => {
    expect(slug("a".repeat(500)).length).toBeLessThanOrEqual(60)
  })

  test("a project is named by its last two segments, so two checkouts differ", () => {
    expect(projectSlug("/Users/me/code/opencode-cockpit")).toBe("code-opencode-cockpit")
    expect(projectSlug("/Users/me/forks/opencode-cockpit")).toBe("forks-opencode-cockpit")
  })
})

describe("where a review lives", () => {
  test("under the data directory, by project and branch", () => {
    const paths = reviewPaths("/Users/me/code/cockpit", "feat/x", env)
    expect(paths.dir).toBe("/data/opencode-cockpit/review/code-cockpit-feat-x")
  })

  test("a thread is one file in it", () => {
    const paths = reviewPaths("/Users/me/code/cockpit", "main", env)
    expect(paths.fileFor("rv_00000abc12")).toBe(
      "/data/opencode-cockpit/review/code-cockpit-main/rv_00000abc12.json",
    )
  })

  /** No repository is not an error: a project without git can still review this conversation. */
  test("no branch still names a directory", () => {
    expect(reviewPaths("/tmp/scratch", undefined, env).dir).toContain("no-branch")
  })

  test("COCKPIT_HOME wins, so a development copy can keep its own reviews", () => {
    const paths = reviewPaths("/Users/me/code/cockpit", "main", { COCKPIT_HOME: "/tmp/ck" })
    expect(paths.dir).toBe("/tmp/ck/review/code-cockpit-main")
  })

  test("data, not cache — losing a half-finished review to a sweep is losing a half-finished job", () => {
    const paths = reviewPaths("/p", "b", { HOME: "/home/me" })
    expect(paths.dir).toContain(".local/share")
  })
})
