import { claimFeature, duplicateFeatureMessage } from "@opencode-cockpit/client"
import {
  dualServer,
  type ServerHost,
  type ServerParts,
  type ServerStart,
} from "@opencode-cockpit/client/server"
import { waitingOn } from "../core/model/thread.ts"
import { reviewPaths } from "../core/store/paths.ts"
import { createPersistence, type Persistence } from "../core/store/persist.ts"
import { createTools } from "./tools/index.ts"
import type { FileContents } from "./tools/shared.ts"

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
export function createReviewServer({ source = REVIEW_PACKAGE }: ReviewServerOptions = {}): ServerStart {
  return async (host) => {
    const claim = claimFeature(host.scope, "review", source)
    if (!claim.active) {
      host.log.warn(duplicateFeatureMessage("Review", claim.owner, source))
      return {}
    }
    const parts = await reviewParts(host)
    return { ...parts, dispose: () => claim.release() }
  }
}

async function reviewParts(host: ServerHost): Promise<ServerParts> {
  const { directory } = host
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
   * A file's text as it is now, for checking a resolve — read through the host, which refuses a path
   * outside the project.
   *
   * The host resolves the path, so a read that succeeds is a path that exists in this project — and
   * that is the path the review files things under. A suffix the host cannot resolve comes back
   * undefined, and the tools say so rather than filing a note nobody will see.
   */
  const contentsOf = async (path: string): Promise<FileContents | undefined> => {
    const text = await host.readFile(path)
    return text === undefined ? undefined : { path, text }
  }

  return {
    tools: createTools({ directory, store, contentsOf }),
    /** Said once per conversation, the way Shell explains its shells. */
    system: async () => {
      const system = [GUIDANCE]

      /**
       * And what is actually waiting, so the agent does not have to ask to find out there is nothing.
       * One line, never the threads themselves: the list is a tool call away and a system prompt is
       * not the place to put a review.
       */
      const waiting = await store()
        .then((persistence) => persistence.load())
        /** Waiting on *it*, not merely unresolved: its own notes are waiting on the person. */
        .then((threads) => threads.filter((thread) => waitingOn(thread) === "agent"))
        .catch(() => [])
      if (waiting.length > 0) {
        const files = [...new Set(waiting.map((thread) => thread.file))]
        system.push(
          `${waiting.length} review comment${waiting.length === 1 ? "" : "s"} are waiting on you in ${files.join(", ")}. Read them with review_list.`,
        )
      }
      return system
    },
  }
}

export default dualServer("opencode-cockpit.review", createReviewServer())
