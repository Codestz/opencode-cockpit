/**
 * The second half of `/cockpit-setup`: making Cockpit fit how a person works. What the agent needs
 * for it, read fresh — what this project runs that never ends, which ticket keys its history uses,
 * where its pull requests go, what the instruction files say now — and the one write it makes: a
 * marked `## Cockpit conventions` section in an `AGENTS.md`.
 *
 * Conventions only. How to use Cockpit is already in every request's system prompt (each bay's
 * guidance); what a project's own instructions add is the part no bay can know — "the dev server is
 * `bun dev`", "tickets are COM-…".
 *
 * The section is written here rather than by the agent's edit tool because it has to be the same
 * section every time: a rerun replaces it in place, everything around it is kept byte for byte, and a
 * model asked to "update the section" in someone's instructions file is one rewrite away from
 * tidying the rest.
 *
 * This file is the marked section itself, found and written in place; `instructions.ts` is where it
 * goes, `project.ts` what it says.
 */

export const SECTION_START =
  "<!-- cockpit-conventions: start · written by /cockpit-setup, which updates it in place -->"
export const SECTION_END = "<!-- cockpit-conventions: end -->"
export const SECTION_HEADING = "## Cockpit conventions"

/** Matches a start marker however its tail was edited: the prefix is what marks it. */
const START = /<!--\s*cockpit-conventions:\s*start\b[^>]*-->/g
const END = /<!--\s*cockpit-conventions:\s*end\s*-->/g

export interface Section {
  /** Offsets of the start marker and just past the end marker. */
  start: number
  end: number
  /** What is between the heading and the end marker, trimmed. */
  body: string
}

export type Sections = { ok: true; sections: Section[] } | { ok: false; line: number }

const lineAt = (text: string, offset: number) => text.slice(0, offset).split("\n").length

/** Every marked section in a file, in order. A start with no end is an error naming its line. */
export function findSections(text: string): Sections {
  const sections: Section[] = []
  const ends = [...text.matchAll(END)]
  for (const start of text.matchAll(START)) {
    const from = start.index ?? 0
    if (sections.some((section) => from < section.end)) continue
    const end = ends.find((each) => (each.index ?? 0) > from)
    if (!end) return { ok: false, line: lineAt(text, from) }
    const stop = (end.index ?? 0) + end[0].length
    const inner = text.slice(from + start[0].length, end.index).trim()
    const body = inner.startsWith(SECTION_HEADING) ? inner.slice(SECTION_HEADING.length).trim() : inner
    sections.push({ start: from, end: stop, body })
  }
  return { ok: true, sections }
}

/** The body as the agent hands it, without a heading of its own (the section brings one). */
export function cleanBody(body: string): string {
  const text = body.replaceAll("\r\n", "\n").trim()
  return text.startsWith(SECTION_HEADING) ? text.slice(SECTION_HEADING.length).trim() : text
}

export function sectionText(body: string, eol = "\n"): string {
  return [SECTION_START, SECTION_HEADING, "", ...cleanBody(body).split("\n"), SECTION_END].join(eol)
}

export type WriteAction = "created" | "added" | "updated" | "unchanged" | "removed" | "absent"

export type Written =
  | { ok: true; action: WriteAction; text: string | undefined; merged: number }
  | { ok: false; error: string }

/** Cuts `[start, end)` and the blank line that set it apart, so removing a section undoes adding it. */
function cut(text: string, start: number, end: number): string {
  let from = start
  while (from > 0 && (text[from - 1] === "\n" || text[from - 1] === "\r")) from--
  const before = text.slice(0, from)
  let after = text.slice(end)
  if (from === 0) after = after.replace(/^\r?\n/, "")
  return before.length > 0 && after.length === 0 ? `${before}\n` : before + after
}

/**
 * The file with its section set to `body`: replaced where it is, added at the end where there is
 * none, removed when `body` is empty. Everything outside the section is kept as it was. Several
 * sections (two runs that raced, a paste) become one, where the first was. `text` undefined is a file
 * that does not exist; `text: undefined` back means delete it — it held nothing but the section.
 */
export function writeSection(text: string | undefined, body: string): Written {
  const content = cleanBody(body)
  const found = findSections(text ?? "")
  if (!found.ok)
    return {
      ok: false,
      error: `the Cockpit section that starts at line ${found.line} has no end marker. Add \`${SECTION_END}\` on its own line where the section ends (or remove the start marker), then call this again.`,
    }
  /** CRLF only for a file written that way throughout; a stray `\r\n` in a LF file is not a style. */
  const eol = text?.includes("\r\n") && !/(^|[^\r])\n/.test(text) ? "\r\n" : "\n"
  const [first, ...extra] = found.sections
  if (!first) {
    if (!content) return { ok: true, action: "absent", text, merged: 0 }
    if (text === undefined || text.trim() === "")
      return {
        ok: true,
        action: text === undefined ? "created" : "added",
        text: `${sectionText(content, eol)}${eol}`,
        merged: 0,
      }
    const sep = text.endsWith("\n") ? eol : `${eol}${eol}`
    return { ok: true, action: "added", text: `${text}${sep}${sectionText(content, eol)}${eol}`, merged: 0 }
  }
  let out = text as string
  for (const section of [...extra].reverse()) out = cut(out, section.start, section.end)
  if (!content) {
    out = cut(out, first.start, first.end)
    return { ok: true, action: "removed", text: out.trim() === "" ? undefined : out, merged: extra.length }
  }
  out = out.slice(0, first.start) + sectionText(content, eol) + out.slice(first.end)
  const action = extra.length === 0 && first.body === content && out === text ? "unchanged" : "updated"
  return { ok: true, action, text: out, merged: extra.length }
}
