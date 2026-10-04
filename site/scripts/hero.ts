/**
 * Writes media/hero.gif — the landing's hero window through one loop — for the README, which cannot
 * run the page. It is a recording of the bays' own renderers, so regenerate it when they change:
 *
 *   bun run build && bun scripts/hero.ts      (needs Google Chrome and ffmpeg)
 *
 * One loop exactly, from the hero's own second zero (LOOP, src/scripts/landing.ts), so the GIF wraps
 * without a seam; screenshots of the window, not a screen recording, so there is no clock to line up;
 * captured at 2×, 1680 px wide and the full 256 colours, so the text stays sharp wherever GitHub draws it.
 */
import { spawn } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { chromium } from "playwright-core"

const LOOP = 28
/** Wide enough that GitHub scales it down, on a retina screen too. */
const WIDTH = Number(process.env.WIDTH ?? 1680)
const PORT = 4399
const site = resolve(import.meta.dir, "..")
const out = resolve(site, "..", "media", "hero.gif")
const chrome = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const scratch = mkdtempSync(join(tmpdir(), "cockpit-hero-"))

const preview = spawn("bunx", ["astro", "preview", "--port", String(PORT)], { cwd: site, stdio: "ignore" })
const run = (cmd: string, args: string[]) =>
  new Promise<void>((done, fail) => spawn(cmd, args, { stdio: "inherit" }).on("exit", (code) => (code === 0 ? done() : fail(new Error(`${cmd} exited ${code}`)))))

try {
  await new Promise((wait) => setTimeout(wait, 3000))
  const browser = await chromium.launch({ executablePath: chrome, headless: true })
  // captured at 2×: GitHub shows the GIF at up to ~880 px, so on a retina screen it is drawn from
  // twice that — a 1× capture is stretched and the text goes soft
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 2 })
  await page.goto(`http://localhost:${PORT}/opencode-cockpit/`, { waitUntil: "networkidle" })
  // the window alone: no nav over it, no labels beside it
  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = "auto"
    for (const el of document.querySelectorAll<HTMLElement>(".nav, .callout")) el.style.display = "none"
    const win = document.querySelector<HTMLElement>(".deck .window")!
    scrollTo(0, win.getBoundingClientRect().top + scrollY - 20)
  })
  const win = page.locator(".deck .window")
  // start on a fresh loop, at the hero's own second zero
  await page.waitForFunction(() => document.getElementById("hero-work")?.textContent === "working 1s", undefined, { polling: 20 })
  await page.waitForFunction(() => document.getElementById("hero-work")?.textContent === "working 0s", undefined, { polling: 20, timeout: (LOOP + 5) * 1000 })
  // one loop of frames, each lasting until the next was taken
  const frames: { file: string; at: number }[] = []
  const start = Date.now()
  while (Date.now() - start < LOOP * 1000) {
    const file = join(scratch, `${String(frames.length).padStart(4, "0")}.png`)
    const at = Date.now() - start
    await win.screenshot({ path: file })
    frames.push({ file, at })
    const next = (frames.length * 1000) / 6
    await new Promise((wait) => setTimeout(wait, Math.max(0, next - (Date.now() - start))))
  }
  await browser.close()
  const list = frames
    .map((frame, i) => `file '${frame.file}'\nduration ${(((frames[i + 1]?.at ?? LOOP * 1000) - frame.at) / 1000).toFixed(3)}`)
    .join("\n")
  const concat = join(scratch, "frames.txt")
  await Bun.write(concat, `${list}\nfile '${frames.at(-1)!.file}'\n`)
  await run("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", concat, "-vf",
    `fps=6,scale=${WIDTH}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=none:diff_mode=rectangle`, out])
  console.log(`wrote ${out} — ${frames.length} frames`)
} finally {
  preview.kill()
  rmSync(scratch, { recursive: true, force: true })
}
