import { type ToolDefinition, tool } from "@opencode-ai/plugin"
import { emptyReview, open as openThread } from "../../core/model/review.ts"
import type { ToolKit } from "./shared.ts"

const OPEN = `Leave a review comment of your own, on a line or a whole file.

    review_open file="src/config.ts" line=41 text="This retries forever if the host is down."
    review_open file="src/config.ts" from=40 to=52 text="Worth a test for the empty case."
    review_open file="src/config.ts" text="This file is doing two jobs."

For things worth saying about the code that are not what you were asked to do right now: a bug you
noticed on the way past, a decision that wants a second opinion, work you are deliberately leaving.
The person sees it in the review panel beside their own notes and can answer it there.

A note here outlives this conversation — it is on the branch, not in the chat. That is the point:
write the ones a future reader needs, not a running commentary.`

const z = tool.schema

/**
 * The agent's own notes.
 *
 * This exists because the guidance already promised it. An earlier version argued the list described
 * threads well enough that opening one needed no tool — which confused *reading* a review with
 * *taking part in one*, and left the system prompt telling agents they could do something they had no
 * way to do.
 *
 * It writes through the same store the panel reads, so a note the agent leaves is a note you see.
 */
export function reviewOpen(kit: ToolKit): ToolDefinition {
  return tool({
    description: OPEN,
    args: {
      file: z.string().describe("The file, as it appears in the diff. A suffix is enough."),
      line: z.number().int().positive().optional().describe("A single line the note is about"),
      from: z.number().int().positive().optional().describe("Instead of line: the first line"),
      to: z.number().int().positive().optional().describe("With from: the last line"),
      text: z.string().min(1).describe("What is worth saying about it"),
    },
    async execute(args) {
      const store = await kit.store()
      const threads = await store.load()

      /**
       * The file is named the way the agent has it, which may be a suffix of the real path.
       *
       * An existing thread on the same file is the best evidence of the full path — the person
       * already filed one there. Failing that, the host resolves it, and what the host resolves is
       * what the review files the note under. A name that resolves to nothing is refused: a thread
       * under a path the diff does not use is a note nobody will ever see.
       */
      const known = threads.find((thread) => thread.file.endsWith(args.file))?.file
      const found = await kit.contentsOf(known ?? args.file)
      const file = known ?? found?.path
      if (!file) {
        return `No file matches "${args.file}". Name it as it appears in the diff.`
      }

      const first = args.from ?? args.line
      const last = args.from === undefined ? undefined : (args.to ?? args.from)
      /** The lines as they read now, so the note still shows its code after the file moves on. */
      const quoted =
        first === undefined || found === undefined
          ? undefined
          : found.text.split("\n").slice(first - 1, last ?? first)

      const review = openThread(
        { ...emptyReview(), threads: [...threads] },
        {
          file,
          ...(first === undefined ? {} : { line: first }),
          ...(last === undefined || last === first ? {} : { through: last }),
          ...(quoted?.length ? { quoted } : {}),
        },
        args.text,
        "agent",
      )
      /**
       * Which thread actually changed — not "the last one".
       *
       * A note on lines somebody has already commented on *continues* that thread rather than starting
       * a rival beside it, so the thread that was written may sit anywhere in the list. Taking the last
       * one saved the wrong thread whenever that happened.
       */
      const before = new Map(threads.map((each) => [each.id, each]))
      const written = review.threads.find((each) => before.get(each.id) !== each)
      if (!written) return "Could not open that comment."
      await store.save(written)

      const where =
        first === undefined
          ? "the whole file"
          : last && last !== first
            ? `lines ${first}–${last}`
            : `line ${first}`
      return before.has(written.id)
        ? `Added to ${written.id}, the thread already on ${file} · ${where}. It is waiting on the person now.`
        : `Opened ${written.id} on ${file} · ${where}. It is waiting on the person now.`
    },
  })
}
