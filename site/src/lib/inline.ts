/** Copy with `code` in it → HTML: escaped, and each backticked span a <code>. Nothing else. */
export const inline = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
