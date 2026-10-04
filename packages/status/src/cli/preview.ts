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
import { homedir } from "node:os"
import { budgetFile, readBudget } from "../core/budget.ts"
import { type ResolvedLine, resolveLines, type Surface } from "../core/config.ts"
import { loadCustomSegments, resolveModulePath } from "../core/custom.ts"
import { FIXTURES, type FixtureName } from "../core/fixtures.ts"
import { moduleNoticeText } from "../core/notices.ts"
import {
  type ConfigAs,
  drawState,
  parseArgs,
  plainRuns,
  previewSettings,
  SIDEBAR_WIDTH,
} from "../core/preview.ts"
import type { SegmentDef } from "../core/segments.ts"
import { paintRuns as paintColour } from "./ansi.ts"

const args = parseArgs(process.argv.slice(2))
const flag = (name: keyof typeof args.values) => args.values[name]
const has = (name: Parameters<typeof args.switches.has>[0]) => args.switches.has(name)

if (has("help")) {
  console.log(`
  preview — draw your statusline here, against sample sessions, as OpenCode will

    --config <path>   this file in place of your global config, with no project file beside it
                      (default: your global config, then this folder's .cockpit.json)
    --config -        a config on stdin, as the file it is meant to become, the other read beside it:
                        cat <<'EOF' | preview --config - --debug
                        { "status": { "override": { "git": { "against": "branch" } } } }
                        EOF
    --as <file>       global | project: the file --config stands in for (stdin: global by default)
    --surface <name>  sidebar | bottom: draw there, whatever the settings say
    --proxy <path>    the budget file a proxy writes, for spend and avail (none: draw without one)
    --module <path>   draw this module's segments, on their own
    --with-config     ...and the config's modules and segments as well
    --state <name>    ${Object.keys(FIXTURES).join(" | ")} (default: every one)
    --width <n>       columns for the line (default: ${SIDEBAR_WIDTH} in the sidebar, the terminal's at the bottom)
    --debug           name every row: ✓name drew, ✗name drew nothing, ?name is no segment at all
    --watch           redraw whenever the config or a module changes
`)
  process.exit(0)
}
/** A flag the preview cannot read stops it: ignored, it drew some other settings than the ones meant. */
if (args.errors.length > 0) {
  for (const error of args.errors) console.error(`  ${error}`)
  process.exit(2)
}

const directory = process.cwd()
const expand = (path: string) => (path === "~" || path.startsWith("~/") ? homedir() + path.slice(1) : path)
const configFlag = flag("config")
/**
 * `--config -`: the candidate on stdin, as the file it is meant to become (`--as`, global by default),
 * with the other file read beside it as OpenCode will. An agent previews what it is about to write
 * without writing it anywhere first — a temporary file outside the project is a permission prompt on
 * OpenCode 1, and one inside it is a stray file in the user's repo.
 */
const fromStdin = configFlag === "-"
const configPath = configFlag && !fromStdin ? expand(configFlag) : undefined
const as = (flag("as") ?? (fromStdin ? "global" : undefined)) as ConfigAs | undefined
const stdinText = fromStdin ? await Bun.stdin.text() : undefined
const surface = flag("surface") as Surface | undefined

/**
 * Through the loader and the resolution the bay itself uses (`previewSettings`), so the preview reads
 * a file exactly as OpenCode will — its `status` section, comments, `preset`, `sidebarRows` and
 * `override` — and draws the same `!` rows for what it will not read. A file that cannot be read
 * stops the preview: the defaults drawn in its place would look like a file that changed nothing.
 */
function settings() {
  if (stdinText !== undefined) return previewSettings({ directory, configText: stdinText, as, surface })
  if (!configPath) return previewSettings({ directory, surface })
  let configText: string
  try {
    configText = readFileSync(configPath, "utf8")
  } catch (error) {
    console.error(`  cannot read --config ${configPath}: ${(error as Error).message}`)
    process.exit(2)
  }
  return previewSettings({ directory, configText, surface, ...(as ? { as } : {}) })
}

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

/** Everything a draw needs, read again on every redraw so `--watch` follows the config too. */
async function prepare(fresh = false) {
  const { loaded, lines: configured, target } = settings()
  const config = loaded.config
  const modules = [...(isolate ? [] : (config.modules ?? [])), ...(only ? [only] : [])]
  let custom: ReadonlyMap<string, SegmentDef> = new Map()
  const moduleErrors: string[] = []
  if (modules.length > 0) {
    const imported = await loadCustomSegments(
      modules,
      directory,
      // Bun caches modules by specifier: without a fresh one an edit would never show.
      fresh ? (path) => import(`${path}?v=${Date.now()}`) : undefined,
    )
    custom = imported.segments
    moduleErrors.push(...imported.errors)
    for (const error of imported.errors) console.error(`  module failed: ${error}`)
  }
  /**
   * On its own, a module draws every segment it declares, in the order it declares them, with room
   * for all of them — a column capped at the default eight silently hides the rest of a gallery.
   */
  const lines: ResolvedLine[] = isolate
    ? resolveLines({
        surface: surface ?? config.surface,
        separator: config.separator,
        stack: config.stack,
        icons: config.icons,
        debug: config.debug,
        paddingLeft: config.paddingLeft,
        paddingRight: config.paddingRight,
        segments: [...custom.keys()],
        sidebarRows: Math.max(config.sidebarRows ?? 0, custom.size),
      })
    : configured
  /** The `!` rows the bay would draw above its first line. */
  const troubles = [...loaded.notices, ...moduleErrors.map(moduleNoticeText)]
  return { lines, modules, custom, troubles, target }
}

/**
 * A proxy's budget, as the bay reads it: the file the lines name, or `--proxy`. `--proxy none` draws
 * the line as someone without a proxy sees it.
 */
const proxy = flag("proxy")
const budgetFor = (lines: readonly ResolvedLine[]) => {
  const at = proxy === "none" ? undefined : proxy ? resolveModulePath(proxy, directory) : budgetFile(lines)
  return at ? readBudget(at) : undefined
}

const states = flag("state") ? [flag("state") as FixtureName] : (Object.keys(FIXTURES) as FixtureName[])
const width = Number(flag("width") ?? 0) || 0
/** Colour for a terminal, plain text under NO_COLOR or into a pipe — as Subagents and the Updater do. */
const color = process.stdout.isTTY === true && !process.env.NO_COLOR
const paint = color ? paintColour : plainRuns
const dim = (text: string) =>
  color ? `${String.fromCharCode(27)}[38;2;110;120;132m${text}${String.fromCharCode(27)}[0m` : text

/** Which settings these are, so a preview of one file cannot pass for a preview of another. */
const sourceOf = (target: string | undefined) =>
  fromStdin
    ? `(stdin, as ${target})`
    : configPath
      ? `${configPath}${target ? `, as ${target}` : ""}`
      : "your global config, then this folder's .cockpit.json"

async function draw(fresh = false): Promise<string[]> {
  const { lines, modules, custom, troubles, target } = await prepare(fresh)
  const budget = budgetFor(lines)
  const debug = has("debug") || lines.some((line) => line.debug)
  console.log(`\n  ${dim(`config: ${sourceOf(target)}${surface ? ` · --surface ${surface}` : ""}`)}`)
  for (const state of states) {
    const fixture = FIXTURES[state]
    if (!fixture) {
      console.error(`  unknown state "${state}" — try ${Object.keys(FIXTURES).join(", ")}`)
      process.exit(1)
    }
    console.log(`\n${dim(`── ${state} — ${fixture.about}`)}`)
    const rows = drawState({
      lines,
      troubles,
      fixture,
      terminal: process.stdout.columns || 120,
      width,
      debug,
      custom,
      ...(budget ? { budget } : {}),
      paint,
      dim,
    })
    for (const row of rows) console.log(row)
  }
  console.log()
  return modules
}

const modules = await draw()

/** Redraw on change, because the point of a preview is the loop and not the picture. */
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
          console.clear()
          void draw(true)
        }, 120)
      })
    } catch {
      // A file that cannot be watched is not a reason to stop previewing.
    }
  }
}
