/** Log search helpers: what matched, and how failures should read. */
export function splitMatches(text: string, query: string): { text: string; match: boolean }[] {
  if (!query) return [{ text, match: false }]
  const parts: { text: string; match: boolean }[] = []
  const haystack = text.toLowerCase()
  const needle = query.toLowerCase()
  let from = 0
  for (let at = haystack.indexOf(needle, from); at !== -1; at = haystack.indexOf(needle, from)) {
    if (at > from) parts.push({ text: text.slice(from, at), match: false })
    parts.push({ text: text.slice(at, at + needle.length), match: true })
    from = at + needle.length
  }
  if (from < text.length) parts.push({ text: text.slice(from), match: false })
  return parts.length > 0 ? parts : [{ text, match: false }]
}

/** Daemon errors name ids and internal states; say what happened instead. */
export function friendlyError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  if (/is (exited|killed|failed)$/.test(message)) return "the shell is no longer running"
  if (/not found$/.test(message)) return "that shell was already removed"
  if (/connection|not running|did not start/.test(message)) return "lost connection to cockpitd, retrying"
  return message
}
