import { type ToolDefinition, tool } from "@opencode-ai/plugin"
import { describe, type ToolKit } from "./shared.ts"

const LIST = `Read the review comments waiting on you.

A person has read this branch's diff and left notes on specific lines. Each one is a thread: what
they said, anything already replied, and whether it is still waiting on you.

- Default: everything still open or answered — the ones that need something from you.
- status="all": resolved threads too, for when you want the history of a file.
- file="src/thing.ts": only that file's threads.

Call this before answering a review in chat. The threads are the review; the chat message is only a
nudge that they are there.`

const z = tool.schema

export function reviewList(kit: ToolKit): ToolDefinition {
  return tool({
    description: LIST,
    args: {
      file: z
        .string()
        .optional()
        .describe('Only threads on this file, e.g. "src/core/config.ts". A suffix is enough.'),
      status: z
        .enum(["waiting", "all"])
        .default("waiting")
        .describe('"waiting" is open and answered threads; "all" includes resolved ones'),
    },
    async execute(args) {
      const store = await kit.store()
      const threads = await store.load()

      const wanted = threads
        .filter((thread) => (args.status === "all" ? true : thread.status !== "resolved"))
        .filter((thread) => (args.file ? thread.file.endsWith(args.file) : true))

      if (wanted.length === 0) {
        return threads.length === 0
          ? "No review comments on this branch."
          : "Nothing waiting on you — every thread on this branch is resolved."
      }

      /** The file's current text, so a thread whose code has moved can say so rather than mislead. */
      const contents = new Map<string, string | undefined>()
      for (const thread of wanted) {
        if (!contents.has(thread.file)) contents.set(thread.file, await kit.contentsOf(thread.file))
      }

      const body = wanted.map((thread) => describe(thread, contents.get(thread.file))).join("\n\n")
      return `${wanted.length} review thread${wanted.length === 1 ? "" : "s"} on this branch:\n\n${body}\n\nReply with review_reply, and set resolved=true only on threads whose code you actually changed.`
    },
  })
}
