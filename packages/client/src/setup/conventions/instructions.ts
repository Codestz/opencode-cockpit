/** Where the section goes: the instruction files OpenCode reads, project and global, as they are now. */

import { join } from "node:path"
import { findSections } from "./section.ts"

export type InstructionScope = "project" | "global"

export interface InstructionFile {
  scope: InstructionScope
  path: string
  exists: boolean
  /** The section's body when there is one; several are reported as a count. */
  sections: number
  body?: string
  /** The line of a start marker with no end. */
  unclosed?: number
  /**
   * OpenCode 1 reads the first file it finds of a list and stops there: `AGENTS.md` before the
   * project's `CLAUDE.md` (and `CONTEXT.md`), the global `AGENTS.md` before `~/.claude/CLAUDE.md`.
   * Read off 1.18.32's instruction loader. So creating this file stops OpenCode 1 reading that one.
   */
  shadows?: string
}

export function instructionPaths(
  directory: string,
  env: Readonly<Record<string, string | undefined>>,
  home: string,
): Record<InstructionScope, string> {
  return {
    project: join(directory, "AGENTS.md"),
    global: join(env.XDG_CONFIG_HOME || join(home, ".config"), "opencode", "AGENTS.md"),
  }
}

export function readInstructions(
  opencode: 1 | 2,
  directory: string,
  env: Readonly<Record<string, string | undefined>>,
  home: string,
  read: (path: string) => string | undefined,
): InstructionFile[] {
  const paths = instructionPaths(directory, env, home)
  const fallbacks: Record<InstructionScope, string[]> = {
    project: [join(directory, "CLAUDE.md"), join(directory, "CONTEXT.md")],
    global: [join(home, ".claude", "CLAUDE.md")],
  }
  return (["project", "global"] as const).map((scope) => {
    const path = paths[scope]
    const text = read(path)
    const found = findSections(text ?? "")
    const shadows =
      opencode === 1 && text === undefined
        ? fallbacks[scope].find((file) => read(file) !== undefined)
        : undefined
    return {
      scope,
      path,
      exists: text !== undefined,
      sections: found.ok ? found.sections.length : 0,
      ...(found.ok && found.sections[0] ? { body: found.sections[0].body } : {}),
      ...(found.ok ? {} : { unclosed: found.line }),
      ...(shadows ? { shadows } : {}),
    }
  })
}
