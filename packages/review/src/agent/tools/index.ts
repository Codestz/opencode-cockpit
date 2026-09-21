import type { ToolDefinition } from "@opencode-ai/plugin"
import { reviewList } from "./list.ts"
import { reviewOpen } from "./open.ts"
import { reviewReply } from "./reply.ts"
import { createToolKit, type ToolDeps } from "./shared.ts"

export type { ToolDeps } from "./shared.ts"

/**
 * The review tools an agent sees. Three, and each one is a thing a reviewer does.
 *
 * Replying and resolving are one tool rather than two, because they are the same act with a different
 * ending: a separate resolve would invite resolving in silence, which is the one outcome nobody wants.
 *
 * `review_open` was argued away once — the list describes threads well enough to answer one, so why
 * would opening need a tool? Because answering a review and taking part in one are different things,
 * and the system prompt was already telling agents they could leave notes of their own. A promise in
 * the guidance with no tool behind it is a bug with good manners.
 */
export function createTools(deps: ToolDeps): Record<string, ToolDefinition> {
  const kit = createToolKit(deps)
  return {
    review_list: reviewList(kit),
    review_open: reviewOpen(kit),
    review_reply: reviewReply(kit),
  }
}
