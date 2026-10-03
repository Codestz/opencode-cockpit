/**
 * The change sets a diff view gets wrong.
 *
 * Designing against one tidy two-line edit is how a view ends up unreadable on the day it matters —
 * forty files, or one file three thousand lines long, or a file that did not exist a minute ago.
 * The preview draws all of these, so none of them is discovered in OpenCode.
 */

import { type ImageLook, tooLargeText } from "./image/looks.ts"
import { SAMPLE, sampleLook } from "./image/samples.ts"
import type { BinarySide, ChangeSet, FileChange } from "./model/review.ts"

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

/** A PNG side, as git and the header reader would describe it. */
const png = (width: number, height: number, size: number): BinarySide => ({
  size,
  image: { format: "png", width, height },
})

/** A binary file change: no text, no counts, what each side is. */
const image = (
  path: string,
  before: BinarySide | undefined,
  after: BinarySide | undefined,
  change?: FileChange["change"],
): FileChange => ({
  path,
  before: "",
  after: "",
  additions: 0,
  deletions: 0,
  ...(change ? { change } : {}),
  binary: { ...(before ? { before, revision: "a1b2c3d" } : {}), ...(after ? { after } : {}) },
})

export interface Fixture {
  about: string
  changes: ChangeSet
  /** What the pane would know about the images once decoded. */
  looks?: ReadonlyMap<string, ImageLook>
}

export const FIXTURES: Record<string, Fixture> = {
  /** The ordinary case: a few files, edits you can read at a glance. */
  turn: {
    about: "one turn's work — three files, a mix of edits",
    changes: {
      source: "worktree",
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
    about: "a new file, a deleted one, and one moved and touched",
    changes: {
      source: "worktree",
      files: [
        {
          path: "src/core/notices.ts",
          before: "",
          after: TS_AFTER,
          additions: 18,
          deletions: 0,
          change: "added",
        },
        {
          path: "src/old/legacy.ts",
          before: TS_BEFORE,
          after: "",
          additions: 0,
          deletions: 10,
          change: "deleted",
        },
        /** Moved and touched: the diff is the touch, and the heading says where it came from. */
        {
          path: "src/core/settings.ts",
          from: "src/config/load.ts",
          change: "renamed",
          before: TS_BEFORE,
          after: TS_BEFORE.replace("JSON.parse(raw)", "JSON.parse(raw.trim())"),
          additions: 1,
          deletions: 1,
        },
      ],
    },
  },

  /** More files than fit a dock: the list has to page, and progress has to mean something. */
  sprawl: {
    about: "forty files — the list is the problem, not the diff",
    changes: {
      source: "worktree",
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
      source: "worktree",
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
    about: "no trailing newline, whitespace-only changes (a space, a tab, line endings), a rewritten file",
    changes: {
      source: "worktree",
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
        /** Spaces to a tab: the same line twice, unless the tab is drawn. */
        {
          path: "src/indent.ts",
          before: "if (ready) {\n    start()\n}\n",
          after: "if (ready) {\n\tstart()\n}\n",
          additions: 1,
          deletions: 1,
        },
        /** Windows line endings to Unix ones: every line changed, and none of them visibly. */
        {
          path: "src/endings.ts",
          before: "export const one = 1\r\nexport const two = 2\r\n",
          after: "export const one = 1\nexport const two = 2\n",
          additions: 2,
          deletions: 2,
        },
      ],
    },
  },

  /**
   * Binaries: every state an image change can be in, and a binary that is not an image.
   *
   * The pictures are drawn in code (`image/samples.ts`) and go through the real shrink and pixel diff,
   * so what the preview shows is what the pane would.
   */
  images: {
    about: "binaries — changed, resized, new, deleted, a JPEG, one too large, one not an image",
    changes: {
      source: "branch",
      files: [
        /** First, so the preview marks it viewed and the pictures below stay open. */
        image("assets/font.woff2", { size: 12_595 }, { size: 14_336 }),
        image("media/dashboard.png", png(288, 180, 807_358), png(288, 180, 789_120)),
        image("media/thumbnail.png", png(288, 180, 826_548), png(144, 90, 220_412)),
        image("media/logo.png", undefined, png(96, 96, 12_904), "added"),
        image(
          "media/old-banner.gif",
          { size: 574_310, image: { format: "gif", width: 288, height: 180 } },
          undefined,
          "deleted",
        ),
        image(
          "media/photo.jpg",
          { size: 368_596, image: { format: "jpeg", width: 4032, height: 3024 } },
          { size: 341_022, image: { format: "jpeg", width: 4032, height: 3024 } },
        ),
        image("media/poster.png", png(12_000, 9_000, 182_400_000), png(12_000, 9_000, 183_100_512)),
      ],
    },
    looks: new Map([
      ["media/dashboard.png", sampleLook(SAMPLE.before, SAMPLE.after, 1)],
      ["media/thumbnail.png", sampleLook(SAMPLE.before, SAMPLE.resized, 2)],
      ["media/logo.png", sampleLook(undefined, SAMPLE.logo, 3)],
      ["media/old-banner.gif", sampleLook(SAMPLE.before, undefined, 4)],
      ["media/poster.png", { problem: tooLargeText(12_000, 9_000), stamp: 5 }],
    ]),
  },

  /** Nothing to review. The first thing anyone sees, and the easiest to leave looking broken. */
  clean: {
    about: "no changes at all — what you see before the agent has done anything",
    changes: { source: "worktree", files: [] },
  },
}

export type FixtureName = keyof typeof FIXTURES
