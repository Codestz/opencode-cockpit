/**
 * Reads `opencode.jsonc`: JSON plus comments and trailing commas.
 *
 * Read-only on purpose. The updater never writes a config file — `opencode plugin -f` does, and it
 * keeps the comments — so a parser that throws the comments away is all this needs.
 */

export type JsoncResult = { ok: true; value: unknown } | { ok: false; message: string }

export function parseJsonc(text: string): JsoncResult {
  try {
    return { ok: true, value: JSON.parse(withoutTrailingCommas(withoutComments(text))) }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

/** Index just past the string starting at `i`, escapes included, so `"http://x"` stays a string. */
function stringEnd(text: string, i: number): number {
  let j = i + 1
  while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1
  return j + 1
}

function withoutComments(text: string): string {
  let out = ""
  let i = 0
  while (i < text.length) {
    const ch = text[i] as string
    const next = text[i + 1]
    if (ch === '"') {
      const end = stringEnd(text, i)
      out += text.slice(i, end)
      i = end
    } else if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++
    } else if (ch === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2)
      i = end === -1 ? text.length : end + 2
    } else {
      out += ch
      i++
    }
  }
  return out
}

function withoutTrailingCommas(text: string): string {
  let out = ""
  let i = 0
  while (i < text.length) {
    const ch = text[i] as string
    if (ch === '"') {
      const end = stringEnd(text, i)
      out += text.slice(i, end)
      i = end
      continue
    }
    if (ch === ",") {
      let j = i + 1
      while (j < text.length && /\s/.test(text[j] as string)) j++
      if (text[j] === "}" || text[j] === "]") {
        i++
        continue
      }
    }
    out += ch
    i++
  }
  return out
}
