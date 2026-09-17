import type { KeyEvent } from "@opentui/core"

const NAMED: Record<string, string> = {
  return: "\r",
  enter: "\r",
  linefeed: "\n",
  tab: "\t",
  backspace: "\x7f",
  escape: "\x1b",
  space: " ",
  up: "\x1b[A",
  down: "\x1b[B",
  right: "\x1b[C",
  left: "\x1b[D",
  home: "\x1b[H",
  end: "\x1b[F",
  pageup: "\x1b[5~",
  pagedown: "\x1b[6~",
  delete: "\x1b[3~",
  insert: "\x1b[2~",
}

/**
 * Re-encodes a parsed key as legacy terminal bytes. The TUI may receive keys via the kitty
 * protocol, whose raw form programs in the PTY would not understand.
 */
export function keyToBytes(e: KeyEvent): string | undefined {
  if (e.eventType === "release") return undefined
  const name = e.name?.toLowerCase() ?? ""
  if (e.name === "tab" && e.shift) return "\x1b[Z"
  const named = NAMED[name]
  if (named !== undefined) return e.meta || e.option ? `\x1b${named}` : named
  if (e.ctrl && name.length === 1) {
    const code = name.toUpperCase().charCodeAt(0)
    if (code >= 64 && code <= 95) return String.fromCharCode(code - 64)
  }
  const text =
    e.sequence && !e.sequence.startsWith("\x1b")
      ? e.sequence
      : name.length === 1
        ? e.shift
          ? name.toUpperCase()
          : name
        : undefined
  if (!text) return undefined
  return e.meta || e.option ? `\x1b${text}` : text
}

/** ctrl+] releases typing mode (the telnet escape), since esc and ctrl+c belong to the program. */
export function isReleaseKey(e: KeyEvent): boolean {
  return e.ctrl && (e.name === "]" || e.sequence === "\x1d")
}
