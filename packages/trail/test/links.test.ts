import { describe, expect, test } from "bun:test"
import {
  cleanUrl,
  linkKey,
  linksIn,
  openable,
  secretParam,
  systemOf,
  workIn,
  workOf,
} from "../src/core/links.ts"

describe("the system a link belongs to", () => {
  test.each([
    ["https://github.com/Codestz/opencode-cockpit/pull/33", "GitHub"],
    ["https://acme.atlassian.net/wiki/spaces/ENG/pages/1", "Confluence"],
    ["https://acme.atlassian.net/browse/COM-1736", "Jira"],
    ["https://claude.ai/public/artifacts/9f2c", "Claude"],
    ["https://linear.app/acme/issue/ENG-42/retry", "Linear"],
    ["https://gitlab.com/group/project/-/merge_requests/12", "GitLab"],
    ["https://www.notion.so/acme/Plan-123", "notion.so"],
    ["https://status.acme.dev/incidents/88", "status.acme.dev"],
  ])("%s → %s", (url, system) => {
    expect(systemOf(url)).toBe(system)
  })

  test("no link, or not a web link, has no system", () => {
    expect(systemOf(undefined)).toBeUndefined()
    expect(systemOf("file:///tmp/notes.md")).toBeUndefined()
    expect(systemOf("COM-1736")).toBeUndefined()
  })

  test("the table is extensible: a row added is read", () => {
    expect(systemOf("https://ci.acme.dev/job/1", [{ host: "ci.acme.dev", name: "Jenkins" }])).toBe("Jenkins")
  })
})

describe("safe links", () => {
  test("only http(s) opens", () => {
    expect(openable("https://github.com/x")).toBe(true)
    expect(openable("http://localhost:3000")).toBe(true)
    for (const url of ["javascript:alert(1)", "file:///etc/passwd", "ssh://host", "", undefined])
      expect(openable(url)).toBe(false)
  })

  test("secret-looking query parameters and credentials are stripped; the rest stays", () => {
    const { url, stripped } = cleanUrl(
      new URL(
        "https://user:pw@s3.amazonaws.com/b/k?X-Amz-Signature=abc&X-Amz-Credential=c&versionId=3&token=t&sig=s&view=full",
      ),
    )
    expect(url).toBe("https://s3.amazonaws.com/b/k?versionId=3&view=full")
    expect(stripped).toEqual(["credentials", "X-Amz-Signature", "X-Amz-Credential", "token", "sig"])
  })

  test.each([
    "token",
    "access_token",
    "api_key",
    "key",
    "signature",
    "client_secret",
    "X-Goog-Signature",
    "githubToken",
    "private_token",
  ])("%s is a secret", (name) => {
    expect(secretParam(name)).toBe(true)
  })

  test.each(["view", "page", "tab", "q", "versionId", "monkey"])("%s is not", (name) => {
    expect(secretParam(name)).toBe(false)
  })
})

describe("PRs and issues, from their links", () => {
  test("GitHub pull and issue", () => {
    expect(workOf("https://github.com/Codestz/opencode-cockpit/pull/33/files")).toEqual({
      url: "https://github.com/Codestz/opencode-cockpit/pull/33",
      ref: "Codestz/opencode-cockpit#33",
      label: "PR #33",
    })
    expect(workOf("https://github.com/acme/web/issues/12#issuecomment-1")?.label).toBe("issue #12")
  })

  test("GitLab merge requests and issues, on any host", () => {
    expect(workOf("https://git.acme.dev/group/sub/project/-/merge_requests/7")).toEqual({
      url: "https://git.acme.dev/group/sub/project/-/merge_requests/7",
      ref: "group/sub/project!7",
      label: "MR !7",
    })
    expect(workOf("https://gitlab.com/g/p/-/issues/3")?.ref).toBe("g/p#3")
  })

  test("Jira browse and Linear issues", () => {
    expect(workOf("https://acme.atlassian.net/browse/COM-1736?focusedCommentId=1")).toEqual({
      url: "https://acme.atlassian.net/browse/COM-1736",
      ref: "COM-1736",
      label: "COM-1736",
    })
    expect(workOf("https://linear.app/acme/issue/ENG-42/retry-the-socket")?.ref).toBe("ENG-42")
  })

  test("anything else is not a work item", () => {
    for (const url of [
      "https://github.com/acme/web",
      "https://github.com/acme/web/pull/new/branch",
      "https://acme.atlassian.net/wiki/x/1",
      "https://example.com/pull/3",
    ])
      expect(workOf(url)).toBeUndefined()
  })

  test("found in output, prose punctuation and repeats left out", () => {
    const text =
      "Created https://github.com/a/b/pull/1.\nSee (https://github.com/a/b/pull/1/files) and https://acme.atlassian.net/browse/X-9, https://example.com."
    expect(workIn(text).map((work) => work.url)).toEqual([
      "https://github.com/a/b/pull/1",
      "https://acme.atlassian.net/browse/X-9",
    ])
    expect(linksIn(text)).toContain("https://example.com")
  })

  test("two links to one thing compare equal", () => {
    expect(linkKey("https://github.com/a/b/pull/1/files")).toBe(linkKey("https://GitHub.com/a/b/pull/1"))
    expect(linkKey("https://Docs.acme.dev/page/")).toBe(linkKey("https://docs.acme.dev/page#top"))
    expect(linkKey("https://docs.acme.dev/page?id=1")).not.toBe(linkKey("https://docs.acme.dev/page?id=2"))
  })
})
