/**
 * Handing the review over.
 *
 * Every note dialog in the pane ends with the words "nothing is sent until you submit the review",
 * and until now there was nothing to submit with: you wrote notes, and then separately remembered to
 * mention them in the conversation. That is not a review, it is a notepad beside a chat.
 *
 * Submit is deliberately small. The agent fetches threads through `review_list`, so the message does
 * not carry them — it says the review is ready and how much of it there is, and the notes travel as
 * structured data rather than as prose the agent has to parse back out of a chat message.
 *
 * **Unless the tools are not there.** A TUI-only install, or a server half switched off, and the
 * whole review goes into the message as text. The loop degrades to a one-shot review rather than
 * breaking, and the person is never left with a comment nobody will read.
 */

import type { Review } from "./review.ts"
import { anchorOf, describeThread, type Thread, waitingOn } from "./thread.ts"

export interface Submission {
  /** What is sent to the conversation. */
  text: string
  /** The threads it is about — what the pane says in its toast, and what the tests count. */
  threads: readonly Thread[]
  /** Threads held back because the code they are about is gone. Worth saying, not worth sending. */
  outdated: readonly Thread[]
}

export interface SubmitOptions {
  /** What is being reviewed: `feat/x → main`, or the source's own name. */
  label?: string
  /** The person's own sentence, when they wrote one. */
  summary?: string
  /**
   * Whether the agent has the review tools.
   *
   * Told, not guessed: only the TUI half can see the user's plugin list, and sending "use review_list"
   * to an agent that has no such tool is worse than sending too much.
   */
  tools: boolean
  /**
   * The files as they read now, by path, for deciding which comments still have code under them.
   *
   * Without it nothing is treated as outdated, which is the right default: a submit that cannot see
   * the files should send everything rather than silently hold half of it back.
   */
  files?: ReadonlyMap<string, string>
}

/** The threads a submit is about: the ones waiting on the agent, in the order they were written. */
export function waitingOnAgent(review: Review): Thread[] {
  return review.threads.filter((thread) => waitingOn(thread) === "agent")
}

const count = (threads: readonly Thread[]): string =>
  threads.length === 1 ? "1 comment" : `${threads.length} comments`

/**
 * The message, or nothing at all.
 *
 * Nothing is a real answer: a review with every thread answered has nothing to hand over, and sending
 * "0 comments" would be asking the agent to look at an empty list.
 */
export function submission(review: Review, options: SubmitOptions): Submission | undefined {
  const waiting = waitingOnAgent(review)
  /**
   * A comment about code that no longer exists is not work, it is history.
   *
   * Sending it asks the agent to act on lines it cannot find, and the honest answer — "that code is
   * gone" — is one you already know. They stay in the panel, badged, and out of the handover.
   */
  const outdated = waiting.filter(
    (thread) => anchorOf(thread, options.files?.get(thread.file)).state === "outdated",
  )
  const threads = waiting.filter((thread) => !outdated.includes(thread))
  if (threads.length === 0) return undefined

  const about = options.label ? ` on ${options.label}` : ""
  const said = options.summary?.trim()
  /** The person's sentence leads. It is the only part of this a human wrote. */
  const opening = said ? `${said}\n\n` : ""

  if (options.tools) {
    return {
      threads,
      outdated,
      text: `${opening}I have left ${count(threads)}${about}. Run \`review_list\` to read them with the code each one is about, then work them: change what needs changing and \`review_reply\` with resolved=true, or reply saying why not.`,
    }
  }

  /**
   * The same review, carried in the message.
   *
   * Each thread keeps its id even here — the person may install the server half tomorrow, and an id
   * in the transcript is still the id on disk.
   */
  const written = threads.map((thread) => describeThread(thread)).join("\n\n")
  return {
    threads,
    outdated,
    text: `${opening}I have left ${count(threads)}${about}. They are below, with the code each one was written against. Work them: change what needs changing, and say what you changed under each one.\n\n${written}`,
  }
}

/**
 * Whether the agent has the review tools, from the plugin list the person configured.
 *
 * A guess would be worse than either answer: telling an agent to "run `review_list`" when it has no
 * such tool leaves the review unread, while sending the whole thing as prose to an agent that *does*
 * have the tools is only wasteful. So it is read from the one place that actually knows — and an
 * entry can be a bare name or a `[name, options]` pair, because both are legal in `opencode.json`.
 */
export function toolsConfigured(
  plugins: ReadonlyArray<string | [string, unknown]> | undefined,
  name: string,
): boolean {
  return (plugins ?? []).some((entry) => (typeof entry === "string" ? entry : entry[0]).includes(name))
}
