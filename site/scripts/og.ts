/**
 * Renders the social card. Run it when the wordmark or the pitch changes:
 *
 *   bun scripts/og.ts
 *
 * Kept as a script rather than a build step: the output is committed, so a deploy never depends on
 * image tooling.
 */
import { writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import sharp from "sharp"

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0d1219"/><stop offset="1" stop-color="#0a0c10"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#g)"/>
  <rect x="0" y="0" width="1200" height="4" fill="#6aa6ff"/>

  <g transform="translate(96,104)">
    <rect x="0" y="0" width="44" height="44" rx="12" fill="none" stroke="#6aa6ff" stroke-width="3"/>
    <path d="M12 33V20M22 33v-7M32 33V13" stroke="#6aa6ff" stroke-width="3.4" stroke-linecap="round"/>
    <text x="62" y="33" font-family="Sora, Geist, sans-serif" font-size="30" font-weight="600" fill="#e9edf3">Cockpit</text>
    <text x="180" y="33" font-family="Geist Mono, monospace" font-size="17" fill="#667283">instruments for OpenCode</text>
  </g>

  <text x="96" y="286" font-family="Sora, Geist, sans-serif" font-size="66" font-weight="600" fill="#e9edf3">Give your agent a flight deck,</text>
  <text x="96" y="364" font-family="Sora, Geist, sans-serif" font-size="66" font-weight="600" fill="#e9edf3">not another tool call.</text>

  <text x="96" y="430" font-family="Geist, sans-serif" font-size="26" fill="#98a3b3">Background terminals that keep running, report their own health,</text>
  <text x="96" y="466" font-family="Geist, sans-serif" font-size="26" fill="#98a3b3">and never need watching.</text>

  <g transform="translate(96,516)">
    <rect x="0" y="0" width="560" height="56" rx="12" fill="#12161d" stroke="#1e2530" stroke-width="2"/>
    <text x="24" y="36" font-family="Geist Mono, monospace" font-size="21" fill="#6aa6ff">$</text>
    <text x="48" y="36" font-family="Geist Mono, monospace" font-size="21" fill="#e9edf3">opencode plugin opencode-cockpit</text>
  </g>
</svg>`

const out = join(resolve(import.meta.dir, ".."), "public", "og.png")
writeFileSync(out, await sharp(Buffer.from(svg)).png().toBuffer())
console.log(`wrote ${out}`)
