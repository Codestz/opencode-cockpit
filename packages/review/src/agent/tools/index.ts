import type { ToolDefinition } from "@opencode-ai/plugin"
import { reviewList } from "./list.ts"
import { reviewReply } from "./reply.ts"
import { createToolKit, type ToolDeps } from "./shared.ts"

export type { ToolDeps } from "./shared.ts"

/**
 * The review tools an agent sees. Two, deliberately.
 *
 * There is no `review_open`, because the list already describes every thread well enough to answer
 * one — the same reason Shell has no tool for opening a shell it has just listed. And replying and
 * resolving are one tool rather than two, because they are the same act with a different ending: a
 * separate resolve would invite resolving in silence, which is the one outcome nobody wants.
 */
export function createTools(deps: ToolDeps): Record<string, ToolDefinition> {
  const kit = createToolKit(deps)
  return {
    review_list: reviewList(kit),
    review_reply: reviewReply(kit),
  }
}
