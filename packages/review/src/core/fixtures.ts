/**
 * The change sets a diff view gets wrong.
 *
 * Designing against one tidy two-line edit is how a view ends up unreadable on the day it matters —
 * forty files, or one file three thousand lines long, or a file that did not exist a minute ago.
 * The preview draws all of these, so none of them is discovered in OpenCode.
 */

import type { ChangeSet } from "./model/review.ts"

const lines = (count: number, token: string) =>
  `${Array.from({ length: count }, (_, i) => `${token} ${i + 1}`).join("\n")}\n`

const TS_BEFORE = `import { readFileSync } from "node:fs"

export function load(path: string): Config {
  const raw = readFileSync(path, "utf8")
  return JSON.parse(raw) as Config
}

export function merge(base: Config, over: Config): Config {
  return { ...base, ...over }
}
`

const TS_AFTER = `import { existsSync, readFileSync } from "node:fs"

export function load(path: string): Config {
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Config
  } catch {
    // A half-written config should not take the whole line down with it.
    return {}
  }
}

export function merge(base: Config, over: Config): Config {
  const merged = { ...base, ...over }
  if (base.modules || over.modules) merged.modules = [...(base.modules ?? []), ...(over.modules ?? [])]
  return merged
}
`

export const FIXTURES: Record<string, { about: string; changes: ChangeSet }> = {
  /** The ordinary case: a few files, edits you can read at a glance. */
  turn: {
    about: "one turn's work — three files, a mix of edits",
    changes: {
      source: "session",
      files: [
        { path: "src/core/config.ts", before: TS_BEFORE, after: TS_AFTER, additions: 11, deletions: 3 },
        {
          path: "src/tui/index.tsx",
          before: "const open = false\nrender(<App open={open} />)\n",
          after: "const open = true\nrender(<App open={open} theme={theme} />)\n",
          additions: 2,
          deletions: 2,
        },
        {
          path: "docs/config.md",
          before: "# Config\n\nSee the source.\n",
          after: "# Config\n\nEvery setting, and what it is for.\n",
          additions: 1,
          deletions: 1,
        },
      ],
    },
  },

  /** A file that did not exist: every line is an addition and there is no left-hand side. */
  created: {
    about: "a new file, and a deleted one",
    changes: {
      source: "session",
      files: [
        { path: "src/core/notices.ts", before: "", after: TS_AFTER, additions: 18, deletions: 0 },
        { path: "src/old/legacy.ts", before: TS_BEFORE, after: "", additions: 0, deletions: 10 },
      ],
    },
  },

  /** More files than fit a dock: the list has to page, and progress has to mean something. */
  sprawl: {
    about: "forty files — the list is the problem, not the diff",
    changes: {
      source: "session",
      files: Array.from({ length: 40 }, (_, i) => ({
        path: `packages/app/src/module-${String(i + 1).padStart(2, "0")}/index.ts`,
        before: lines(12, "old"),
        after: lines(12, "old").replace("old 6", "new 6"),
        additions: 1,
        deletions: 1,
      })),
    },
  },

  /** One enormous file: scrolling, and the cost of diffing it at all. */
  huge: {
    about: "a three-thousand-line file with two edits far apart",
    changes: {
      source: "session",
      files: [
        {
          path: "src/generated/schema.ts",
          before: lines(3000, "field"),
          after: lines(3000, "field")
            .replace("field 40\n", "renamed 40\n")
            .replace("field 2900\n", "renamed 2900\n"),
          additions: 2,
          deletions: 2,
        },
      ],
    },
  },

  /** The awkward ones: no trailing newline, whitespace-only, a file that moved wholesale. */
  awkward: {
    about: "no trailing newline, a whitespace-only change, a rewritten file",
    changes: {
      source: "session",
      files: [
        {
          path: "src/no-newline.ts",
          before: "const a = 1",
          after: "const a = 2",
          additions: 1,
          deletions: 1,
        },
        {
          path: "src/spacing.ts",
          before: "const a = 1\n",
          after: "const a = 1 \n",
          additions: 1,
          deletions: 1,
        },
        {
          path: "src/rewritten.ts",
          before: lines(20, "was"),
          after: lines(20, "now"),
          additions: 20,
          deletions: 20,
        },
      ],
    },
  },

  /** Nothing to review. The first thing anyone sees, and the easiest to leave looking broken. */
  clean: {
    about: "no changes at all — what you see before the agent has done anything",
    changes: { source: "session", files: [] },
  },
}

export type FixtureName = keyof typeof FIXTURES
