/**
 * OpenCode's own sidebar blocks.
 *
 * Status's table draws a Context section, so with OpenCode's own Context block on, "Context" shows
 * twice. Turning that block off is OpenCode's setting, in OpenCode's file — so the tool says what it
 * is set to now and how to change it, and the skill asks before touching a file that is not Cockpit's.
 * Measured on 1.18.32 and 2.0.18 (docs/opencode/settings-and-commands.md, "/cockpit-setup spikes").
 */

import { homedir } from "node:os"
import { join } from "node:path"
import { parseJsonc } from "../jsonc.ts"
import { isObject, opencodeDirs, pluginEntries } from "./installs.ts"

/** OpenCode's own sidebar blocks this talks about, and their plugin ids on each version. */
type HostBlock = "context" | "mcp" | "lsp" | "todo" | "files" | "footer"

/**
 * 1.18.32 names its blocks `internal:sidebar-*` and turns one off in `tui.json` with
 * `"plugin_enabled": { "<id>": false }`. 2.0.18 names them `opencode.sidebar.*`, turns one off with
 * `"-<id>"` in `cli.json`'s `plugins` list, and has no LSP, Todo or Files block at all. Every id is
 * the binary's own, and each switch was measured hiding its block (MCP and Footer on both versions in
 * an isolated run, 2026-10-03) — except Files, whose block never drew in a test run to hide.
 */
export const HOST_BLOCKS: Readonly<Record<1 | 2, Partial<Record<HostBlock, string>>>> = {
  1: {
    context: "internal:sidebar-context",
    mcp: "internal:sidebar-mcp",
    lsp: "internal:sidebar-lsp",
    todo: "internal:sidebar-todo",
    files: "internal:sidebar-files",
    footer: "internal:sidebar-footer",
  },
  2: { context: "opencode.sidebar.context", mcp: "opencode.sidebar.mcp", footer: "opencode.sidebar.footer" },
}

/** One of OpenCode's interface config files, and which of the blocks it switches. */
export interface HostFile {
  path: string
  found: boolean
  error?: string
  /** Block id → on or off, as this file writes it. */
  blocks: Record<string, boolean>
}

/** The files OpenCode reads its interface settings from: the global one, then the project's. */
export function hostFilePaths(
  opencode: 1 | 2,
  directory: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  home: string = homedir(),
): string[] {
  const name = opencode === 1 ? "tui" : "cli"
  return opencodeDirs(directory, env, home).flatMap((dir) => [
    join(dir, `${name}.json`),
    join(dir, `${name}.jsonc`),
  ])
}

/** What one file says about the blocks. Never throws: a file that will not parse says so. */
export function readHostFile(opencode: 1 | 2, path: string, text: string | undefined): HostFile {
  if (text === undefined) return { path, found: false, blocks: {} }
  const parsed = parseJsonc(text)
  const value = parsed.ok ? parsed.value : undefined
  if (!isObject(value))
    return { path, found: true, error: parsed.ok ? "not a JSON object" : parsed.message, blocks: {} }
  const ids = Object.values(HOST_BLOCKS[opencode])
  const blocks: Record<string, boolean> = {}
  if (opencode === 1) {
    const enabled = value.plugin_enabled
    if (isObject(enabled))
      for (const [id, on] of Object.entries(enabled))
        if (ids.includes(id) && typeof on === "boolean") blocks[id] = on
  } else {
    for (const { name } of pluginEntries(value)) {
      const off = name.startsWith("-")
      const id = off ? name.slice(1) : name
      if (ids.includes(id)) blocks[id] = !off
    }
  }
  return { path, found: true, blocks }
}
