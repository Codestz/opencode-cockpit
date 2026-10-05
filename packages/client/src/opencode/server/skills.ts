/** A skill's folder, read the way OpenCode 2 takes it. */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { SkillSpec } from "./parts.ts"
import type { V2Skill } from "./v2.ts"

/**
 * A skill's folder as v2 takes it: name and description from the frontmatter, the text without it
 * (v1 strips it too). Undefined when the file is missing or names nothing — logged by the caller, never
 * thrown: no skill is worth the agent side.
 */
export function readSkill(spec: SkillSpec): V2Skill | undefined {
  const path = join(spec.dir, "SKILL.md")
  let text: string
  try {
    text = readFileSync(path, "utf8")
  } catch {
    return undefined
  }
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  const field = (name: string) =>
    match?.[1]
      ?.split(/\r?\n/)
      .find((line) => line.startsWith(`${name}:`))
      ?.slice(name.length + 1)
      .trim()
      .replace(/^(["'])(.*)\1$/, "$2")
  const name = field("name")
  if (!name) return undefined
  const description = field("description")
  return {
    id: name,
    name,
    ...(description ? { description } : {}),
    path,
    content: match ? text.slice(match[0].length) : text,
  }
}
