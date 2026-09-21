import { type ToolDefinition, tool } from "@opencode-ai/plugin"
import { resolve as resolveOn, reply as sayOn } from "../../core/model/thread.ts"
import type { ToolKit } from "./shared.ts"

const REPLY = `Answer one review comment, and say whether it is done.

    review_reply file="src/config.ts" line=41 text="Named the file in the error." resolved=true
    review_reply id="rv_0mgk2x1f4a" text="Deliberate — the caller already holds the lock."

Set resolved=true when you have changed the code the thread is about. Leave it off when you are
answering without changing anything — disagreeing is a reply, not a silence.

Resolving is checked: a thread remembers the lines it was written against, so if they are untouched
the reply is kept and the thread stays open for the person. Say what you changed, not that you
changed something.`

const z = tool.schema

export function reviewReply(kit: ToolKit): ToolDefinition {
  return tool({
    description: REPLY,
    args: {
      id: z.string().optional().describe("Thread id from review_list, e.g. rv_0mgk2x1f4a"),
      file: z.string().optional().describe("Instead of id: the file the thread is on. A suffix is enough."),
      line: z.number().int().positive().optional().describe("With file: a line the thread covers"),
      text: z.string().min(1).describe("What you did, or why you did not"),
      resolved: z
        .boolean()
        .default(false)
        .describe("True only when you changed the code this thread is about"),
    },
    async execute(args) {
      const store = await kit.store()
      const threads = await store.load()
      if (threads.length === 0) return "There are no review comments on this branch."

      const found = kit.find(threads, {
        ...(args.id ? { id: args.id } : {}),
        ...(args.file ? { file: args.file } : {}),
        ...(args.line === undefined ? {} : { line: args.line }),
      })

      if (!found) {
        const open = threads.filter((thread) => thread.status !== "resolved")
        return `No thread matches that. ${open.length} waiting: ${open.map((thread) => `${thread.id} (${thread.file})`).join(", ")}`
      }
      if ("ambiguous" in found) {
        return `That matches ${found.ambiguous.length} threads — say which by id: ${found.ambiguous
          .map((thread) => `${thread.id} (${thread.file}:${thread.line ?? "whole file"})`)
          .join(", ")}`
      }

      const entry = { author: "agent" as const, body: args.text, at: Date.now() }
      const after = args.resolved ? await kit.contentsOf(found.file) : undefined
      const next = args.resolved ? resolveOn(found, entry, after) : sayOn(found, entry)
      await store.save(next)

      if (args.resolved && next.status !== "resolved") {
        /**
         * The claim did not hold, and saying so plainly is the point: an agent told "done" when the
         * file is untouched learns nothing, and the person would have found out by reading.
         */
        return `Replied, but not resolved: ${found.file} still reads exactly as it did when the comment was written, so nothing was changed. The thread is waiting on the person now. Change the code and reply again if you meant to resolve it.`
      }
      return args.resolved
        ? `Resolved ${found.id} (${found.file}).`
        : `Replied on ${found.id} (${found.file}). It is waiting on the person now.`
    },
  })
}
