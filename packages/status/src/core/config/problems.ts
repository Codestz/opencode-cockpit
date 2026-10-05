/** What is wrong in Status's settings that only Status can tell: presets, surfaces, segments, overrides. */

import { closestName } from "@opencode-cockpit/client/settings"
import { baseSegments, isChange, lineSources, PRESETS, segmentType } from "./lines.ts"
import { isObject, type LineConfig, type Override, type StatusConfig, SURFACES } from "./shape.ts"

/** One thing wrong in Status's settings that only Status can tell, and the key it is about. */
export interface StatusProblem {
  /** The section key it is about: `preset`, `surface`, `override`, or `lines` for one of the lines'. */
  key: "preset" | "surface" | "override" | "lines"
  /** Without the `settings: ` the row adds. */
  text: string
}

/**
 * What the loader cannot know is wrong, because only Status knows its vocabulary: a preset nothing
 * answers to, a surface that does not exist. Each used to fall back in silence — an unknown preset
 * was quietly the default line, which looks like a preset that does nothing.
 */
export function configNotices(config: StatusConfig): string[] {
  return configProblems(config).map((problem) => `settings: ${problem.text}`)
}

/** The same, with the key each one is about: for a notice that names its file (`statusNotices`). */
export function configProblems(config: StatusConfig): StatusProblem[] {
  const out: StatusProblem[] = []
  const names = Object.keys(PRESETS).join(", ")
  const lines: LineConfig[] = [config, ...(Array.isArray(config.lines) ? config.lines : [])]
  for (const [index, line] of lines.entries()) {
    const where = index === 0 ? "status" : `status.lines[${index - 1}]`
    const key = index === 0 ? undefined : "lines"
    /** The name first: in a 24-column sidebar it is what survives the wrap. */
    if (typeof line.preset === "string" && !PRESETS[line.preset]) {
      out.push({ key: key ?? "preset", text: `no preset "${line.preset}" (${names})` })
    }
    if (line.surface !== undefined && !SURFACES.includes(line.surface)) {
      out.push({ key: key ?? "surface", text: `"${where}.surface" is "sidebar" or "bottom"` })
    }
  }
  return [...out, ...overrideProblems(config)]
}

/**
 * An override that changes nothing is said out loud: `"gti"` matching no segment would otherwise
 * be a row that kept its old look with no word as to why. A section-wide override is checked against
 * every line that uses it, and is only wrong when it matches none of them.
 */
function overrideProblems(config: StatusConfig): StatusProblem[] {
  const out: StatusProblem[] = []
  const checked = new Map<Override, { where: string; from: string; types: Set<string> }>()
  for (const [index, source] of lineSources(config).entries()) {
    const raw = source.line.override ?? config.override
    const where = source.line.override !== undefined && config.lines?.length ? `status.lines[${index}].` : ""
    if (raw === undefined) continue
    if (!isObject(raw)) {
      out.push({
        key: where ? "lines" : "override",
        text: `"${where || "status."}override" should be an object of segment names`,
      })
      continue
    }
    const base = baseSegments(source.line, config)
    const seen = checked.get(raw) ?? { where, from: base.from, types: new Set<string>() }
    for (const entry of base.segments) seen.types.add(segmentType(entry))
    checked.set(raw, seen)
  }
  for (const [override, { where, from, types }] of checked) {
    const key = where ? "lines" : "override"
    for (const [name, change] of Object.entries(override)) {
      if (!isChange(change)) {
        out.push({
          key,
          text: `${where}override "${name}" is false, a segment name, or an object of its settings`,
        })
      } else if (!types.has(name)) {
        const meant = closestSegment(name, [...types])
        out.push({
          key,
          text: `${where}override "${name}" matches no segment in ${from}${meant ? ` — did you mean "${meant}"?` : ""}`,
        })
      }
    }
  }
  return out
}

/** The name a typo most likely meant: the same letters in another order first (`gti` → `git`). */
function closestSegment(name: string, valid: string[]): string | undefined {
  const letters = (text: string) => [...text].sort().join("")
  return valid.find((each) => letters(each) === letters(name)) ?? closestName(name, valid)
}
