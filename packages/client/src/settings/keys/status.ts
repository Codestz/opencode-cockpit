/** Status's own keys. Defaults equal what the bay hands `baySettings` (`packages/opencode/test/catalog.test.ts`). */

import type { KeyInfo } from "../catalog.ts"

export const STATUS_KEYS: readonly KeyInfo[] = [
  {
    key: "surface",
    type: '"sidebar" | "bottom"',
    default: undefined,
    defaultText: '"sidebar"',
    about: 'where the line draws; `"sidebar": false` says `"bottom"` too',
  },
  {
    key: "preset",
    type: "string",
    default: undefined,
    defaultText: "the surface's own: `sidebar` in the sidebar, `default` at the bottom",
    about: "a whole line by name; anything written beside it wins. The `status-setup` skill has them all",
  },
  {
    key: "segments",
    type: "list",
    default: undefined,
    defaultText: "the preset's",
    about:
      "the line's parts, built-ins or your own — the whole list, replacing the preset's. To change a row or two, `override`",
  },
  {
    key: "override",
    type: "object",
    default: undefined,
    defaultText: "none",
    about:
      'changes to the preset\'s segments by name, the rest kept: `false` drops one, a name swaps it, an object merges into its settings — `{ "git": { "against": "branch" } }`',
  },
  {
    key: "lines",
    type: "list",
    default: undefined,
    defaultText: "one line",
    about: "more than one line, each with its own `surface`, `segments`, `maxRows`…",
  },
  {
    key: "separator",
    type: "string",
    default: undefined,
    defaultText: '`" │ "` across, nothing down',
    about: "drawn between segments",
  },
  {
    key: "stack",
    type: '"horizontal" | "vertical"',
    default: undefined,
    defaultText: "vertical in the sidebar",
    about: "segments across or down",
  },
  {
    key: "icons",
    type: "boolean",
    default: true,
    about: "built-in icons; off for a terminal missing the glyphs",
  },
  {
    key: "debug",
    type: "boolean",
    default: false,
    about: "draw a placeholder where a segment said nothing",
  },
  {
    key: "paddingLeft",
    type: "number",
    default: undefined,
    defaultText: "3 at the bottom, 0 in the sidebar",
    about: "columns of space left of the line",
  },
  {
    key: "paddingRight",
    type: "number",
    default: undefined,
    defaultText: "2 at the bottom, 0 in the sidebar",
    about: "columns of space right of the line",
  },
  {
    key: "paddingTop",
    type: "number",
    default: undefined,
    defaultText: "0",
    about: "rows of space above the line",
  },
  {
    key: "paddingBottom",
    type: "number",
    default: undefined,
    defaultText: "1 at the bottom, 0 in the sidebar",
    about: "rows of space below the line",
  },
  {
    key: "commands",
    type: "object",
    default: undefined,
    defaultText: "none",
    about: "shell commands usable as segments — a Claude Code statusline script works unchanged",
  },
  {
    key: "modules",
    type: "string[]",
    default: undefined,
    defaultText: "none",
    about: "your own segments in TypeScript; a project's add to the global ones",
  },
]
