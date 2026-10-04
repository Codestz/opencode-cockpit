/** Review: the pane (ctrl+x v) over the product's fixtures — a note waiting on the agent, and a PNG diff. */
import { FIXTURES } from "../../../packages/review/src/core/fixtures.ts"
import { emptyReview, open, toggleRead } from "../../../packages/review/src/core/model/review.ts"
import { waitingOnAgent } from "../../../packages/review/src/core/model/submit.ts"
import { layout } from "../../../packages/review/src/core/view/layout.ts"

/** One turn's work: the first file viewed, a note on the second, waiting on the agent. */
export function noted(width: number, height: number) {
  const { changes, looks } = FIXTURES.turn
  const file = changes.files[1].path
  let review = toggleRead(emptyReview(), changes.files[0].path)
  review = open(review, { file, line: 1 }, "this swallows the parse error")
  return layout(changes, review, { file, cursor: file, context: 3, waiting: waitingOnAgent(review).length, ...(looks ? { looks } : {}) } as never, { width, height })
}

/** A changed screenshot: before → after, in the terminal, the changed pixels lit. */
export function image(width: number, height: number, index = 1) {
  const { changes, looks } = FIXTURES.images
  const file = changes.files[index % changes.files.length].path
  return layout(changes, emptyReview(), { file, cursor: file, context: 3, waiting: 0, looks } as never, { width, height })
}
