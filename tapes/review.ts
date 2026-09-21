import { KEYS, type Tape } from "../scripts/record.ts"

/**
 * A review already in progress, the way you would actually meet one.
 *
 *   bun scripts/record.ts tapes/review.ts
 *   bun scripts/tighten.ts tapes/review.cast 1.6     # cap the silences
 *   bun scripts/trim.ts tapes/review.cast --drop 50-119   # cut the wait, keep the answer
 *
 * The last step is the one that matters: the agent takes as long as it takes, so the tape allows for
 * its slowest turn and the wait is cut afterwards. Check the cut before publishing — where the agent
 * finishes moves with the model.
 *
 * The diff is real: the setup commits a file and then rewrites it, so what the panel draws is what
 * git says changed. The two threads already on it are real too — they are the files the panel writes
 * itself, placed before it starts, so the tape can open on a conversation rather than on an empty
 * pane. Every keystroke after that is live.
 */

const COMMITTED = `import type { Cart, Money } from "./types.ts"

/** Adds up a cart. Prices are in minor units, so nothing here is a float. */
export function total(cart: Cart): Money {
  let sum = 0
  for (const line of cart.lines) {
    sum += line.price * line.quantity
  }
  return { amount: sum, currency: cart.currency }
}

export function discount(cart: Cart, percent: number): Money {
  const off = Math.round(total(cart).amount * (percent / 100))
  return { amount: off, currency: cart.currency }
}
`

const CHANGED = `import type { Cart, Money } from "./types.ts"

/** Adds up a cart. Prices are in minor units, so nothing here is a float. */
export function total(cart: Cart): Money {
  let sum = 0
  for (const line of cart.lines) {
    sum += line.price * line.quantity
  }
  if (cart.coupon) {
    sum = sum - couponValue(cart.coupon, sum)
  }
  return { amount: sum, currency: cart.currency }
}

export function discount(cart: Cart, percent: number): Money {
  const off = Math.round(total(cart).amount * (percent / 100))
  return { amount: off, currency: cart.currency }
}

function couponValue(code: string, subtotal: number): number {
  const table: Record<string, number> = { WELCOME: 10, SUMMER: 15 }
  return Math.round(subtotal * ((table[code] ?? 0) / 100))
}
`

const TYPES = `export interface Money {
  amount: number
  currency: string
}

export interface Cart {
  lines: { price: number; quantity: number }[]
  currency: string
  coupon?: string
}
`

/** One thread as the panel writes it: same file, same shape, same format number. */
const thread = (t: Record<string, unknown>) => JSON.stringify({ format: 1, ...t }, null, 2)

/**
 * Where the panel keeps this project's threads.
 *
 * `COCKPIT_HOME` wins over `XDG_DATA_HOME`, and the recorder sets it — so the seeds go here, not
 * where the default layout would put them. The slug is the project's last two path segments and the
 * branch, which for a tape is fixed by the setup above.
 */
const DIR = "review/ck-rec-review-project-main"

export default {
  name: "review",
  title: "A review of the agent's work, with the agent answering",
  /** Smaller than the other tapes: fewer cells means fewer escape sequences, and it embeds larger. */
  cols: 120,
  rows: 32,
  startupMs: 16_000,
  files: {
    "src/checkout/types.ts": TYPES,
    "src/checkout/total.ts": COMMITTED,
  },
  setup: [
    "git init -q -b main",
    "git config user.email tape@example.com",
    "git config user.name Tape",
    "git add -A",
    "git commit -qm 'checkout: totals'",
    // and now the work under review, left uncommitted the way it would be
    `cat > src/checkout/total.ts <<'EOF'\n${CHANGED}EOF`,
  ],
  data: {
    [`${DIR}/rv_0mgk2x1f4a.json`]: thread({
      id: "rv_0mgk2x1f4a",
      file: "src/checkout/total.ts",
      line: 9,
      through: 11,
      quoted: ["  if (cart.coupon) {", "    sum = sum - couponValue(cart.coupon, sum)", "  }"],
      entries: [
        {
          author: "you",
          body: "A coupon changes the total, so this needs a test for an unknown code — the table lookup falls through to zero and nothing says so.",
          at: 1_726_800_000_000,
        },
        {
          author: "agent",
          body: "Added checkout/total.test.ts covering an unknown code, an empty cart and both table entries. The fall-through is deliberate but now it is asserted rather than assumed.",
          at: 1_726_800_060_000,
        },
      ],
      status: "answered",
    }),
    [`${DIR}/rv_0mgk31r8bd.json`]: thread({
      id: "rv_0mgk31r8bd",
      file: "src/checkout/total.ts",
      line: 22,
      quoted: ["function couponValue(code: string, subtotal: number): number {"],
      entries: [
        {
          author: "agent",
          body: "Left the coupon table inline for now. If a third code appears it should come from config rather than grow here.",
          at: 1_726_800_120_000,
        },
      ],
      status: "answered",
    }),
  },
  warmup: [
    /**
     * A real turn, before the recording starts.
     *
     * Not for the look of it: submit hands the review to a *conversation*, and refuses when there is
     * none — correctly, but that refusal is not the demo. One short exchange gives the session the
     * tape needs, and none of its latency is recorded.
     */
    { send: "in one sentence: what is a coupon code?", wait: 1200 },
    { send: KEYS.enter, wait: 14_000 },
  ],
  steps: [
    // open the review over the conversation
    { send: "\x18v", wait: 2200 },
    // and give it the whole window, which is how you read rather than glance
    { send: "w", wait: 2000 },
    // down the tree, into the file that changed
    { send: "j", wait: 700 },
    { send: KEYS.enter, wait: 1800 },
    // down to the thread already on this change, and stop long enough to read the answer
    { send: "j", wait: 500 },
    { send: "j", wait: 600 },
    { send: "j", wait: 3200 },
    // then on to the line worth saying something about
    { send: "j", wait: 700 },
    { send: "j", wait: 1200 },
    // say something about the line the cursor is on
    { send: "c", wait: 1500 },
    { send: "minor units everywhere else — round here too, or a half-penny escapes", wait: 2600 },
    { send: KEYS.enter, wait: 2200 },
    // and hand the review over: the dialog says how much is going, then the toast says it went
    { send: "s", wait: 2800 },
    { send: KEYS.enter, wait: 105_000 },
    // and back into the review, where the agent's answer is now sitting under the comment
    { send: "\x18v", wait: 3000 },
    // a nudge either way: a still frame ends a cast, and this one is worth looking at
    { send: "j", wait: 2500 },
    { send: "k", wait: 4000 },
  ],
} satisfies Tape
