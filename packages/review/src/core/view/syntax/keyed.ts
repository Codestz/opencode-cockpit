/**
 * Keys, values and comments — which is all YAML, TOML and an ini file have.
 *
 * Between them they cover the workflows, the manifests and the configuration that make up a good part
 * of any branch, and all of it used to arrive as undifferentiated text. The curly-brace scanner reads
 * these badly: an unquoted value is not an identifier, and a bare `:` carries the whole structure.
 */

import type { Run, Tone } from "../rows.ts"
import type { Scanner } from "./scan.ts"

export const keyed: Scanner = (text, state) => ({ runs: lineOf(text), state })

function lineOf(text: string): Run[] {
  const hash = text.indexOf("#")
  const code = hash >= 0 ? text.slice(0, hash) : text
  const rest: Run[] = hash >= 0 ? [{ text: text.slice(hash), tone: "comment" }] : []

  const pair = /^(\s*(?:-\s*)?)([A-Za-z0-9_.\-"']+)(\s*[:=])(.*)$/.exec(code)
  if (pair)
    return [
      { text: pair[1] as string },
      { text: pair[2] as string, tone: "keyword" },
      { text: pair[3] as string, tone: "punct" },
      ...(pair[4] ? [{ text: pair[4] as string, tone: "string" as Tone }] : []),
      ...rest,
    ]

  const item = /^(\s*)(-)(\s.*)$/.exec(code)
  if (item)
    return [
      { text: item[1] as string },
      { text: item[2] as string, tone: "operator" },
      { text: item[3] as string, tone: "string" },
      ...rest,
    ]

  return code.length > 0 ? [{ text: code, tone: "string" }, ...rest] : rest
}
