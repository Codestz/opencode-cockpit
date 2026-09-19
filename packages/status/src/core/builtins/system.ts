/** Everything outside the conversation: service health, versions, and your own commands. */

import { parseAnsi } from "../ansi.ts"
import { outputRows } from "../command.ts"
import { unhealthy } from "../context.ts"
import type { SegmentDef } from "../types.ts"
import { num, str } from "./settings.ts"

export const SEGMENTS: SegmentDef[] = [
  {
    name: "diagnostics",
    priority: 90,
    render(ctx) {
      // Silent while everything is healthy: a statusline that always shows "LSP ✓" has spent a
      // column to tell you nothing.
      const broken = [...unhealthy(ctx.lsp), ...unhealthy(ctx.mcp)]
      if (broken.length === 0) return undefined
      const names = broken
        .slice(0, 2)
        .map((item) => item.name)
        .join(", ")
      const more = broken.length > 2 ? ` +${broken.length - 2}` : ""
      return { text: `⚠ ${names}${more}`, tone: "error" }
    },
  },
  {
    name: "version",
    icon: "⌁",
    priority: 10,
    render(ctx) {
      return ctx.version ? { text: `v${ctx.version}`, tone: "muted" } : undefined
    },
  },
  {
    name: "text",
    priority: 40,
    render(_ctx, config) {
      const value = str(config, "value")
      return value ? { text: value, tone: "muted" } : undefined
    },
  },
  {
    name: "command",
    priority: 45,
    render(ctx, config) {
      const name = str(config, "name") ?? "default"
      const value = ctx.commands[name]
      if (!value) return undefined
      // A Claude Code statusline may print several rows; `row` picks one, and each row keeps the
      // colours the script asked for rather than being flattened to grey.
      const row = outputRows(value)[num(config, "row", 0)]
      if (row === undefined) return undefined
      const runs = parseAnsi(row)
      return runs.length > 0 ? { runs } : undefined
    },
  },
]
