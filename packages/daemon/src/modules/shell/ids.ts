const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567"

export function newShellId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  let id = "sh_"
  for (const byte of bytes) id += ALPHABET[byte % 32]
  return id
}
