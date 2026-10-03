#!/usr/bin/env bun
/**
 * Draw your statusline in this terminal, against sample sessions, without restarting OpenCode.
 *
 *   bunx @opencode-cockpit/status preview
 *   bunx @opencode-cockpit/status preview --config ~/.config/opencode-cockpit/config.json
 *   bunx @opencode-cockpit/status preview --state full --width 60
 *   bunx @opencode-cockpit/status preview --proxy ~/.cache/opencode-litellm-iap/spend.json
 *
 * Why this exists: a statusline is a visual thing, and editing TypeScript, restarting OpenCode and
 * squinting is a loop measured in minutes. One sidebar took about twenty restarts to design, and
 * three of the mistakes were glyph choices that read differently in a terminal than they do in a
 * sentence. Nothing here can tell you a design is good; it can tell you what it looks like.
 */

import { readFileSync, watch } from "node:fs"
import { settingsPaths } from "@opencode-cockpit/client/settings"
import { budgetFile, readBudget } from "../core/budget.ts"
import { asSegmentConfig, loadStatus, type ResolvedLine, resolveLines } from "../core/config.ts"
import { loadCustomSegments, resolveModulePath } from "../core/custom.ts"
import { FIXTURES, type FixtureName } from "../core/fixtures.ts"
import { moduleNoticeText, noticeRows } from "../core/notices.ts"
import { fit, fitColumn } from "../core/render.ts"
import { buildSegments, type SegmentDef, segmentWidth } from "../core/segments.ts"
import { paintRuns as paintColour } from "./ansi.ts"

const args = process.argv.slice(2).filter((arg) => arg !== "preview")
const flag = (name: string): string | undefined => {
  const at = args.indexOf(`--${name}`)
  return at === -1 ? undefined : args[at + 1]
}
const has = (name: string) => args.includes(`--${name}`)

if (has("help")) {
  console.log(`
  preview — draw your statusline here, against sample sessions

    --config <path>   a config file (default: your global + project config)
    --proxy <path>    the budget file a proxy writes, for spend and avail (none: draw without one)
    --module <path>   draw this module's segments, on their own
    --with-config     ...and the config's modules and segments as well
    --state <name>    ${Object.keys(FIXTURES).join(" | ")} (default: every one)
    --width <n>       columns available to the line (default: the surface's own)
    --debug           mark segments that drew nothing, so silence and typos look different
    --watch           redraw whenever the config or a module changes
`)
  process.exit(0)
}

const directory = process.cwd()
const configPath = flag("config")
/**
 * Through the loader the bay itself uses, so the preview reads a file exactly as OpenCode will — its
 * `status` section, comments and all — and draws the same `!` rows for what it will not read. A
 * `--config` file stands in for the global one, with no project file beside it.
 */
const global = settingsPaths({ directory }).global
const loadedStatus = loadStatus({
  where: configPath
    ? {
        read: (path) => {
          if (path !== global) return undefined
          try {
            return readFileSync(configPath, "utf8")
          } catch {
            return undefined
          }
        },
      }
    : { directory },
})
const config = loadedStatus.config

/**
 * `--module` draws that module and nothing else.
 *
 * It used to be added to whatever the config already named, which meant the config's *segments*
 * still decided what drew: pointing the preview at a module whose segments the config does not
 * list produced a confident, wrong picture of someone else's line. Looking at one module is the
 * whole reason to pass a path, so that is the default; `--with-config` puts the old behaviour back.
 */
const only = flag("module")
const isolate = only !== undefined && !has("with-config")
const modules = [...(isolate ? [] : (config.modules ?? [])), ...(only ? [only] : [])]
let custom: ReadonlyMap<string, SegmentDef> = new Map()
const moduleErrors: string[] = []
if (modules.length > 0) {
  const loaded = await loadCustomSegments(modules, directory)
  custom = loaded.segments
  moduleErrors.push(...loaded.errors)
  for (const error of loaded.errors) console.error(`  module failed: ${error}`)
}
/** The `!` rows the bay would draw above its first line. */
const troubles = [...loadedStatus.notices, ...moduleErrors.map(moduleNoticeText)]

/**
 * On its own, a module draws every segment it declares, in the order it declares them, with room
 * for all of them — a column capped at the default eight silently hides the rest of a gallery.
 */
const lines = resolveLines(
  isolate
    ? {
        surface: config.surface,
        separator: config.separator,
        stack: config.stack,
        icons: config.icons,
        debug: config.debug,
        paddingLeft: config.paddingLeft,
        paddingRight: config.paddingRight,
        segments: [...custom.keys()],
        sidebarRows: Math.max(config.sidebarRows ?? 0, custom.size),
      }
    : config,
)
/** Where the notices go: the first sidebar line, else the first line — as in the TUI. */
const noticeLine = lines.find((line) => line.surface === "sidebar") ?? lines[0]

/**
 * A proxy's budget, as the bay reads it: the file the lines name, or `--proxy`. `--proxy none` draws
 * the line as someone without a proxy sees it.
 */
const proxy = flag("proxy")
const budgetAt =
  proxy === "none" ? undefined : proxy ? resolveModulePath(proxy, directory) : budgetFile(lines)
const budget = budgetAt ? readBudget(budgetAt) : undefined

const states = flag("state") ? [flag("state") as FixtureName] : (Object.keys(FIXTURES) as FixtureName[])
const debug = has("debug") || config.debug === true

/** The room each surface actually has in OpenCode, so a preview is not wider than the real thing. */
const roomFor = (line: ResolvedLine, terminal: number) =>
  line.surface === "sidebar" ? 34 : terminal - line.paddingLeft - line.paddingRight

const width = Number(flag("width") ?? 0) || 0
/** Colour for a terminal, plain text under NO_COLOR or into a pipe — as Subagents and the Updater do. */
const color = process.stdout.isTTY === true && !process.env.NO_COLOR
const paintRuns: typeof paintColour = (runs) =>
  color ? paintColour(runs) : runs.map((run) => run.text).join("")
const dim = (text: string) =>
  color ? `${String.fromCharCode(27)}[38;2;110;120;132m${text}${String.fromCharCode(27)}[0m` : text

async function draw(): Promise<string[]> {
  const watched: string[] = []
  for (const state of states) {
    const fixture = FIXTURES[state]
    if (!fixture) {
      console.error(`  unknown state "${state}" — try ${Object.keys(FIXTURES).join(", ")}`)
      process.exit(1)
    }
    console.log(`\n${dim(`── ${state} — ${fixture.about}`)}`)

    for (const line of lines) {
      const room = width || roomFor(line, process.stdout.columns || 120)
      const ctx = { ...fixture.ctx, width: room, ...(budget ? { budget } : {}) }
      if (line === noticeLine) {
        for (const row of noticeRows(troubles, room)) console.log(`  ${paintRuns(row.runs).trimEnd()}`)
      }
      const built = buildSegments(ctx, line.segments.map(asSegmentConfig), {
        custom,
        icons: line.icons,
        debug,
      })
      const fitted =
        line.stack === "vertical" ? fitColumn(built, room, line.maxRows) : fit(built, room, line.separator)

      if (fitted.segments.length === 0) {
        console.log(`  ${dim(`(${line.surface}: nothing to draw)`)}`)
        continue
      }
      console.log(`  ${dim(`${line.surface}, ${room} cols`)}`)
      if (line.stack === "vertical") {
        for (const segment of fitted.segments) console.log(`  ${paintRuns(segment.runs)}`)
      } else {
        const parts = fitted.segments.map((segment) => paintRuns(segment.runs))
        console.log(`  ${parts.join(dim(line.separator))}`)
      }
      /** Rows a real sidebar would have dropped in silence. */
      if (fitted.dropped > 0) {
        const over = line.stack === "vertical" ? `sidebarRows is ${line.maxRows}` : `${room} columns`
        console.log(`  ${dim(`↳ ${fitted.dropped} dropped — ${over}`)}`)
      }
      const widest = Math.max(0, ...fitted.segments.map(segmentWidth))
      if (line.stack === "vertical" && widest > room) {
        console.log(`  ${dim(`↳ widest row is ${widest} cols, the column has ${room}`)}`)
      }
    }
  }
  console.log()
  return watched
}

await draw()

/**
 * Redraw on change, because the point of a preview is the loop and not the picture. A module is
 * re-imported under a fresh query string: Bun caches modules by specifier, so without it an edit
 * would show the version from the first run forever.
 */
if (has("watch")) {
  const files = [...modules.map((m) => resolveModulePath(m, directory)), ...(configPath ? [configPath] : [])]
  console.log(dim(`  watching ${files.length} file${files.length === 1 ? "" : "s"} — ctrl+c to stop\n`))
  let pending: ReturnType<typeof setTimeout> | undefined
  for (const file of files) {
    try {
      watch(file, () => {
        clearTimeout(pending)
        // Editors save in bursts; redraw once the burst is over.
        pending = setTimeout(() => {
          void (async () => {
            if (modules.length > 0) {
              const again = await loadCustomSegments(
                modules,
                directory,
                (path) => import(`${path}?v=${Date.now()}`),
              )
              custom = again.segments
              for (const error of again.errors) console.error(`  module failed: ${error}`)
            }
            console.clear()
            await draw()
          })()
        }, 120)
      })
    } catch {
      // A file that cannot be watched is not a reason to stop previewing.
    }
  }
}
