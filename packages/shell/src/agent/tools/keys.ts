const NAMED: Record<string, string> = {
  enter: "\r",
  return: "\r",
  tab: "\t",
  "shift+tab": "\x1b[Z",
  escape: "\x1b",
  esc: "\x1b",
  backspace: "\x7f",
  delete: "\x1b[3~",
  space: " ",
  up: "\x1b[A",
  down: "\x1b[B",
  right: "\x1b[C",
  left: "\x1b[D",
  home: "\x1b[H",
  end: "\x1b[F",
  pageup: "\x1b[5~",
  pagedown: "\x1b[6~",
}

/** Translates named keys (`enter`, `ctrl+c`, `up`) into the bytes a terminal would send. */
export function encodeKey(name: string): string {
  const key = name.trim().toLowerCase()
  const named = NAMED[key]
  if (named !== undefined) return named
  const ctrl = /^(?:ctrl|control|c)[+-]([a-z@[\\\]^_])$/.exec(key)
  if (ctrl?.[1]) return String.fromCharCode(ctrl[1].toUpperCase().charCodeAt(0) - 64)
  throw new Error(
    `unknown key "${name}". Use text for literal input, or one of: ${[...Object.keys(NAMED), "ctrl+<letter>"].join(", ")}`,
  )
}

export const KEY_NAMES = [...Object.keys(NAMED), "ctrl+<letter>"]
