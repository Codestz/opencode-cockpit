/**
 * Review: the pane (ctrl+x v) over the product's own fixture, driven the way a person drives it —
 * the cursor walks the files, one is marked viewed, a note goes on a line, it is handed over, and the
 * agent answers and resolves it. Every state is Review's own model (open, reply, resolve), and
 * resolving is checked as it is in the bay: the line must really have changed.
 */
import { FIXTURES } from "../../../packages/review/src/core/fixtures.ts"
import { emptyReview, open, put, type Review, toggleRead } from "../../../packages/review/src/core/model/review.ts"
import { waitingOnAgent } from "../../../packages/review/src/core/model/submit.ts"
import { resolve } from "../../../packages/review/src/core/model/thread.ts"
import { layout } from "../../../packages/review/src/core/view/layout.ts"

const { changes } = FIXTURES.turn
const files = changes.files.map((f) => f.path)
const NOTE = "this swallows the parse error"
const ANSWER = "It rethrows now, with the file's path — fixed in config.ts:14."

/** One moment of the walk: what the pane shows, and the caption for it. */
export interface Step {
  caption: string
  /** Typing a note: the draft so far, drawn over the pane as Review's note dialog does. */
  draft?: string
}

/** The walk, in order; `frame(i)` draws step i. */
export const STEPS: Step[] = [
  { caption: "ctrl+x v · what changed, file by file" },
  { caption: "space · viewed — the next unread file opens" },
  { caption: "tab · into the diff" },
  { caption: "j · to the line it's about" },
  { caption: "c · a note on this line", draft: NOTE },
  { caption: "enter · saved — waiting on the agent" },
  { caption: "s · handed over: the agent reads it with review_list" },
  { caption: "the agent changed the line and resolved it — checked, not trusted" },
  { caption: "space · viewed — 2 of 3" },
]

export function frame(i: number, width: number, height: number) {
  let review: Review = emptyReview()
  const at = 1_790_000_000_000
  if (i >= 1) review = toggleRead(review, files[0])
  if (i >= 5) review = open(review, { file: files[1], line: 1 }, NOTE, "you", at)
  if (i >= 7) {
    const thread = review.threads[0]
    // the agent's edit: the line the note is on is not what it was
    review = put(review, resolve(thread, { author: "agent", body: ANSWER, at: at + 60_000 }, "changed by the agent\n"))
  }
  if (i >= 8) review = toggleRead(review, files[1])
  const onFile = i === 0 ? files[0] : i >= 8 ? files[2] : files[1]
  const state = {
    file: onFile,
    cursor: onFile,
    context: 3,
    pane: i >= 2 && i < 8 ? "diff" : "files",
    ...(i >= 3 && i < 8 ? { line: 1 } : {}),
    ...(i >= 5 && i < 8 && review.threads[0] ? { thread: review.threads[0].id } : {}),
    waiting: waitingOnAgent(review).length,
  }
  return layout(changes, review, state as never, { width, height })
}

/** A changed screenshot: before → after, in the terminal, the changed pixels lit. */
export function image(width: number, height: number, index = 1) {
  const { changes: imgs, looks } = FIXTURES.images
  const file = imgs.files[index % imgs.files.length].path
  return layout(imgs, emptyReview(), { file, cursor: file, context: 3, waiting: 0, looks } as never, { width, height })
}
