/**
 * Secrets out of the ledger: a command's signature is written to disk, shown in the ledger and logged,
 * so a value that is a secret is replaced before any of that — `TOKEN=‹#3fa9c2›`.
 *
 * **Masked, not dropped.** Two commands with different tokens stay two commands: the mask is a keyed
 * hash of the value (`Hasher`), so trust earned with one value is not trust for another — and the
 * key, kept beside the ledger and never in it, means a weak password cannot be confirmed by hashing
 * guesses. Without a key (tests, the preview) the hash is plain SHA-256, still never the value.
 *
 * **What stays readable** is what Trust reads: an environment word (`NODE_ENV=production`) and a
 * short plain value under a name that does not say secret (`PORT=3000`, `DEBUG=true`). A masked value
 * keeps the environment words found in it — `DATABASE_URL=‹#a1b2c3 prod›` — because families and
 * danger are told apart by them (family.ts): masking must not make a production URL look like dev.
 *
 * **What is masked:**
 * - an env value (`NAME=value` before the program, or `export NAME=value`), unless it stays readable;
 * - a flag's value when the flag names a secret: `--token=…`, `--password …`, `--api-key …`;
 * - a header that carries one: `Authorization: …`, `X-Api-Key: …`, `Cookie: …`;
 * - `Bearer …` anywhere, and the password in `scheme://user:pass@host`;
 * - a token by its shape anywhere in a word: `sk-…`, `ghp_…`, `github_pat_…`, `xoxb-…`, `AKIA…`,
 *   `shpat_…`, a JWT.
 *
 * A miss here leaves a secret where it was before 0.11; it never makes Trust answer more.
 */

import { createHash } from "node:crypto"
import { envWords } from "./env.ts"

/** A value to its mask's hash part: short hex. */
export type Hasher = (value: string) => string

export const plainHash: Hasher = (value) => createHash("sha256").update(value).digest("hex").slice(0, 6)

/** Names that say the value is a secret, as a word of the name: `GITHUB_TOKEN`, `DB_PASSWORD`, `apiKey`. */
const SECRET_NAME =
  /(^|[_-]|[a-z](?=[A-Z]))(token|secret|pass(word|wd|phrase)?|pwd|key|apikey|auth|credentials?|cred|cookie|session|private|signature|sig|dsn|salt|otp|pin)s?($|[_-]|(?<=[a-z])(?=[A-Z]))/i

/** A flag whose value is a secret: `--token`, `--client-secret`, `--password`. */
const SECRET_FLAG =
  /^--?([\w-]*[-_])?(token|secret|pass(word|wd)?|api-?key|auth|credentials?|cookie|session-?id)$/i

/** A value short enough to read at a glance, on one line. Longer is masked: a key, a blob, a script. */
const READABLE = /^[^\n]{1,40}$/
/** A run that looks generated — 20 letters and digits, or 6 digits — rather than written by a person. */
const RANDOM = /[A-Za-z0-9+/_-]{20,}|\d{6,}/

/** A token, by the shapes issuers give them. */
const TOKEN_SHAPE =
  /\b(sk-(?:proj-|ant-|live-|test-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abposr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|shp(?:at|ss|ca|pa)_[a-f0-9]{20,}|glpat-[A-Za-z0-9_-]{16,}|npm_[A-Za-z0-9]{30,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/

const TOKEN = new RegExp(TOKEN_SHAPE.source, "g")

/** `‹#3fa9c2›`, or `‹#3fa9c2 prod›` when the value names an environment. */
export function maskOf(value: string, hash: Hasher): string {
  const places = [...new Set(envWords(value))]
  return `‹#${hash(value)}${places.length > 0 ? ` ${places.join(" ")}` : ""}›`
}

/** Whether `NAME=value` may be shown as it is. */
export function readable(name: string, value: string): boolean {
  if (SECRET_NAME.test(name)) return false
  if (value === "") return true
  return READABLE.test(value) && !TOKEN_SHAPE.test(value) && !RANDOM.test(value)
}

/** `NAME=value`, its value masked unless it is readable. */
export function maskAssignment(word: string, hash: Hasher): string {
  const eq = word.indexOf("=")
  if (eq <= 0) return maskWord(word, hash)
  const name = word.slice(0, eq)
  const value = word.slice(eq + 1)
  /** Readable, a password in a URL is still masked: `postgres://app:‹#…›@db/app`. */
  return readable(name, value) ? `${name}=${maskWord(value, hash)}` : `${name}=${maskOf(value, hash)}`
}

/** Tokens, `Bearer …`, URL passwords and secret headers inside one word. */
export function maskWord(word: string, hash: Hasher): string {
  const header = word.match(
    /^\s*(authorization|proxy-authorization|x-api-key|x-auth-token|api-key|cookie|x-access-token)\s*:\s*(.+)$/is,
  )
  if (header) return `${header[1]}: ${maskOf(header[2] as string, hash)}`
  return word
    .replace(
      /\b(Bearer|Basic|Token)\s+([A-Za-z0-9._~+/=-]{8,})/g,
      (_, kind: string, value: string) => `${kind} ${maskOf(value, hash)}`,
    )
    .replace(
      /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)([^\s@/]+)(@)/gi,
      (_, head: string, value: string, at: string) => `${head}${maskOf(value, hash)}${at}`,
    )
    .replace(TOKEN, (value) => maskOf(value, hash))
}

/**
 * Every word of a command, masked: env assignments in front, then each argument — with a secret
 * flag's value, whether `--token=x` or `--token x`, and `export NAME=value`'s value.
 */
export function maskArgv(argv: readonly string[], hash: Hasher, keep?: ReadonlySet<number>): string[] {
  const out: string[] = []
  const exporting = argv[0] === "export" || argv[0] === "declare" || argv[0] === "set"
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i] as string
    if (keep?.has(i)) {
      out.push(word)
      continue
    }
    const before = argv[i - 1]
    const eq = word.indexOf("=")
    if (before !== undefined && !keep?.has(i - 1) && SECRET_FLAG.test(before) && !word.startsWith("-"))
      out.push(maskOf(word, hash))
    else if (word.startsWith("-") && eq > 0 && SECRET_FLAG.test(word.slice(0, eq)))
      out.push(`${word.slice(0, eq)}=${maskOf(word.slice(eq + 1), hash)}`)
    else if (exporting && i > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) out.push(maskAssignment(word, hash))
    else out.push(maskWord(word, hash))
  }
  return out
}

/** A pattern as OpenCode writes one (`git push *`), masked word by word: its "always" goes in the ledger too. */
export const maskPattern = (pattern: string, hash: Hasher): string =>
  maskArgv(pattern.split(" "), hash).join(" ")
