#!/usr/bin/env bun

/**
 * The see-it loop for what every bay shares: an empty sidebar block, and the `!` row a settings
 * notice draws, at a narrow and a wide column. Colours from OpenCode's default theme.
 *
 *   bun packages/client/src/cli/preview.ts
 *   bun packages/client/src/cli/preview.ts --width 28
 *   bun packages/client/src/cli/preview.ts --config ./my.json   notices for a config file of yours
 *   bun packages/client/src/cli/preview.ts --settings           what the cockpit_settings tool answers
 */

import { readFileSync } from "node:fs"
import { emptyBlock, GLYPH, type ToneRun } from "../design.ts"
import { loadSettings, noticeText, type SettingsNotice } from "../settings/index.ts"
import { settingsReport, settingsText } from "../setup/index.ts"

const HEX: Record<string, string> = {
  text: "#eeeeee",
  muted: "#808080",
  accent: "#9d7cd8",
  warning: "#f5a742",
  error: "#e06c75",
}
const color = process.stdout.isTTY && !process.env.NO_COLOR
const rgb = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).join(";")

function paint(row: readonly ToneRun[]): string {
  if (!color) return row.map((run) => run.text).join("")
  return row
    .map(
      (run) =>
        `\x1b[38;2;${rgb(HEX[run.tone ?? "text"] ?? "#eeeeee")}${run.bold ? ";1" : ""}m${run.text}\x1b[0m`,
    )
    .join("")
}

/** A notice as a bay draws it: `!` in the warning tone, then the sentence, cut to the column. */
function noticeRow(notice: SettingsNotice, width: number): ToneRun[] {
  const said = noticeText(notice)
  const room = width - 2
  const text = said.length > room ? `${said.slice(0, Math.max(0, room - 1))}${GLYPH.more}` : said.padEnd(room)
  return [
    { text: `${GLYPH.warn} `, tone: "warning" },
    { text, tone: "muted" },
  ]
}

const arg = (name: string) => {
  const at = process.argv.indexOf(name)
  return at > 0 ? process.argv[at + 1] : undefined
}
const widths = arg("--width") ? [Number(arg("--width"))] : [24, 36]
const config = arg("--config")
const sample = {
  statusline: { preset: "sidebar" },
  shell: { sidebar: [1] },
  sidebar: ["status", "shells", "trust"],
}
const settings = loadSettings({
  env: {},
  home: "/nowhere",
  directory: "/project",
  read: (path) =>
    path.endsWith(".cockpit.json")
      ? config
        ? readFileSync(config, "utf8")
        : JSON.stringify(sample)
      : undefined,
})

/**
 * `--settings`: what `cockpit_settings` answers, for the sample (or your) config, with the bundle
 * installed. `--opencode 1` for OpenCode 1's own blocks; your own OpenCode files are not read.
 */
if (process.argv.includes("--settings")) {
  const opencode = arg("--opencode") === "1" ? 1 : 2
  const claims = new Map(
    ["shell", "status", "review", "subagents", "trail"].map((bay) => [bay, "opencode-cockpit"]),
  )
  const report = settingsReport({
    opencode,
    directory: "/project",
    claims,
    env: {},
    home: "/home/me",
    read: (path) => {
      if (path.endsWith(".cockpit.json"))
        return config ? readFileSync(config, "utf8") : JSON.stringify(sample)
      if (path === "/home/me/.config/opencode/opencode.json")
        return JSON.stringify({ [opencode === 1 ? "plugin" : "plugins"]: ["opencode-cockpit@0.9.0"] })
      return undefined
    },
  })
  console.log(settingsText(report))
  process.exit(0)
}

for (const width of widths) {
  const ruler = `── ${width} columns `.padEnd(width, "─")
  console.log(ruler)
  for (const title of ["Subagents", "Shells", "Trail"]) {
    for (const row of emptyBlock(title, width)) console.log(`${paint(row)}│`)
    console.log("")
  }
  console.log(`(hideWhenEmpty: ${emptyBlock("Shells", width, true).length} rows)`)
  console.log("")
  for (const notice of settings.notices) console.log(`${paint(noticeRow(notice, width))}│`)
  console.log("")
}
