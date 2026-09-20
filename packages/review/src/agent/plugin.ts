import type { Hooks, Plugin, PluginInput } from "@opencode-ai/plugin"
import { claimFeature, duplicateFeatureMessage } from "@opencode-cockpit/client"
import { reviewPaths } from "../core/store/paths.ts"
import { createPersistence, type Persistence } from "../core/store/persist.ts"
import { createTools } from "./tools/index.ts"

/**
 * What the agent is told about reviews, once, at the top of the conversation.
 *
 * Short on purpose: the tools describe themselves, and this only has to say the thing the tool
 * descriptions cannot — that the review is where this conversation happens, not the chat.
 */
const GUIDANCE = `## Review comments (opencode-cockpit)
A person can leave comments on specific lines of this branch's diff. review_list shows the ones waiting on you.
Work them before answering in chat: change the code, then review_reply with resolved=true, or reply saying why not.
Resolving is checked against the file — a resolve on code you did not change is recorded as a reply instead.
You can open threads yourself: leaving notes as you read is a way to plan work that survives this conversation.`

export const REVIEW_PACKAGE = "@opencode-cockpit/review"

export interface ReviewServerOptions {
  /** Package that loaded Review, reported when a duplicate copy is skipped. */
  source?: string
}

/** Review's server half as a factory, so bundles such as `opencode-cockpit` can include it. */
export function createReviewServer({ source = REVIEW_PACKAGE }: ReviewServerOptions = {}): Plugin {
  return async (input) => {
    const claim = claimFeature(input, "review", source)
    if (!claim.active) {
      // Logging through the server during plugin initialisation could wait on ourselves; defer it.
      setTimeout(() => {
        void input.client.app
          .log({
            body: {
              service: "opencode-cockpit",
              level: "warn",
              message: duplicateFeatureMessage("Review", claim.owner, source),
            },
          })
          .catch(() => {})
      }, 0)
      return {}
    }
    const hooks = await reviewHooks(input)
    return { ...hooks, dispose: async () => claim.release() }
  }
}

async function reviewHooks({ client: opencode, directory }: PluginInput): Promise<Hooks> {
  /**
   * The branch is asked for per call, not cached.
   *
   * A conversation outlives a checkout: branches are switched while a session is open, and a review
   * belongs to the branch it was written against. Resolving the path each time costs one `git`
   * invocation and removes a whole class of "why is it answering the wrong review".
   */
  const branchOf = async (): Promise<string | undefined> => {
    const proc = Bun.spawn(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: directory,
      stdout: "pipe",
      stderr: "ignore",
    })
    const out = (await new Response(proc.stdout).text()).trim()
    return (await proc.exited) === 0 && out && out !== "HEAD" ? out : undefined
  }

  const store = async (): Promise<Persistence> => createPersistence(reviewPaths(directory, await branchOf()))

  /**
   * A file's text as it is now, for checking a resolve.
   *
   * Read through OpenCode rather than the filesystem so it sees the same content the session does,
   * and so a path outside the project is refused by something that already knows how.
   */
  const contentsOf = async (path: string): Promise<string | undefined> => {
    const result = await opencode.file.read({ query: { path } }).catch(() => undefined)
    const content = (result?.data as { content?: string } | undefined)?.content
    return typeof content === "string" ? content : undefined
  }

  return {
    tool: createTools({ opencode, directory, store, contentsOf }),
    /** Said once per conversation, the way Shell explains its shells. */
    "experimental.chat.system.transform": async (_input, output) => {
      output.system.push(GUIDANCE)

      /**
       * And what is actually waiting, so the agent does not have to ask to find out there is nothing.
       * One line, never the threads themselves: the list is a tool call away and a system prompt is
       * not the place to put a review.
       */
      const waiting = await store()
        .then((persistence) => persistence.load())
        .then((threads) => threads.filter((thread) => thread.status !== "resolved"))
        .catch(() => [])
      if (waiting.length > 0) {
        const files = [...new Set(waiting.map((thread) => thread.file))]
        output.system.push(
          `${waiting.length} review comment${waiting.length === 1 ? "" : "s"} are waiting on you in ${files.join(", ")}. Read them with review_list.`,
        )
      }
    },
  }
}
