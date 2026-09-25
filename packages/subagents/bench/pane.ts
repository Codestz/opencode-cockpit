/**
 * How long one paint of the pane takes on a heavy run: 200 calls (reads of 2,000-line files, shell
 * commands), long thinking, a long answer. `bun bench/pane.ts`.
 */
import type { Change } from "../src/core/model/changes.ts"
import { applyAll, emptyModel, subagentsOf } from "../src/core/model/model.ts"
import { createScreenCache, screenRows } from "../src/core/view/screen.ts"

const at = 1_000_000
const file = Array.from(
  { length: 2000 },
  (_, i) => `${i + 1}: ${"const value = compute(input, options) // ".repeat(3)}`,
).join("\n")
const thought = "We need to inspect the repository and understand how sessions are created. ".repeat(40)
const changes: Change[] = [
  { type: "session", id: "c", parentID: "p", agent: "general", title: "Heavy", at },
  { type: "status", id: "c", status: "busy", at },
]
for (let i = 0; i < 200; i++) {
  if (i % 4 === 0)
    changes.push({ type: "thinking", id: "c", key: `t${i}`, text: thought, done: true, at: at + i })
  const bash = i % 5 === 0
  changes.push({
    type: "tool",
    id: "c",
    call: `c${i}`,
    name: bash ? "bash" : "read",
    state: "completed",
    input: bash ? { command: `git log --oneline -${i}` } : { filePath: `/w/src/file${i}.ts` },
    output: file,
    started: at + i,
    ended: at + i + 5,
    at: at + i,
  })
}
changes.push({
  type: "reply",
  id: "c",
  key: "r",
  text: "## Findings\n\n".concat("- **one** finding with `code` in it and more words\n".repeat(200)),
  done: true,
  at: at + 999,
})
const m = applyAll(emptyModel(), changes)
const nodes = subagentsOf(m, "p")
const session = nodes[0]?.session
if (!session) throw new Error("no session")
const open = new Set(["tool:c1", "tool:c2", "tool:c5"])
const cache = createScreenCache()
const base = {
  session,
  nodes,
  width: 110,
  height: 60,
  now: at + 2000,
  frame: 0,
  open,
  closed: new Set<string>(),
  thinking: true,
  details: false,
}

const time = (label: string, fn: () => void, n = 20) => {
  fn()
  const start = performance.now()
  for (let i = 0; i < n; i++) fn()
  console.log(`${label}: ${((performance.now() - start) / n).toFixed(2)} ms per paint`)
}
time("no cache", () => screenRows({ ...base, top: 500 }))
let top = 0
time(
  "cache, scrolling",
  () => {
    top += 3
    screenRows({ ...base, top, cache })
  },
  200,
)
time(
  "cache, spinner tick",
  () => {
    top += 1
    screenRows({ ...base, frame: top, cache })
  },
  200,
)
let n = 10
time(
  "cache, opening one more read",
  () => {
    n += 1
    open.add(`tool:c${n}`)
    screenRows({ ...base, top: 0, cache })
  },
  100,
)
