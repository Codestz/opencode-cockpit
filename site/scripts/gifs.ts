/**
 * Writes the READMEs' GIFs into media/ from the built site — the READMEs cannot run the page, so they
 * show it recorded: the landing's hero window (media/hero.gif) and each bay's own window
 * (media/<bay>.gif), drawn by the bays' own renderers. Regenerate them when the bays change:
 *
 *   bun run build && bun run gifs [name…]      (needs Google Chrome and ffmpeg)
 *
 * Each GIF is one loop of its window exactly, so it wraps without a seam: the hero's from its own
 * second zero, a bay's from wherever it is (a player is periodic, so any full loop wraps). Screenshots
 * of the window, not a screen recording, so there is no clock to line up; captured at 2× and kept
 * large in 256 colours, so the text stays sharp wherever GitHub draws it.
 */
import { spawn } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { chromium, type Page } from "playwright-core"

interface Gif {
  name: string
  /** The page, under the site's base. */
  page: string
  /** The window to capture. */
  window: string
  /** Seconds in one loop — the player's `loop` (src/scripts/live.ts) or the hero's LOOP. */
  loop: number
  /** Output width in pixels; the capture is 2×, so this keeps it at its own size. */
  width: number
}

const GIFS: Gif[] = [
  { name: "hero", page: "", window: ".deck .window", loop: 28, width: 1680 },
  { name: "shell", page: "", window: "#shell .window", loop: 17, width: 1260 },
  { name: "subagents", page: "", window: "#subagents .window", loop: 20, width: 1260 },
  { name: "review", page: "", window: "#review .window", loop: 23.1, width: 1260 },
  { name: "status", page: "", window: "#status .window", loop: 16, width: 1260 },
  { name: "trust", page: "", window: "#trust .window", loop: 17, width: 1260 },
  { name: "updater", page: "", window: "#updater .window", loop: 5.6, width: 1260 },
  { name: "trail", page: "trail/overview/", window: ".live .window", loop: 12, width: 1260 },
]

const PORT = 4399
const FPS = Number(process.env.FPS ?? 6)
const site = resolve(import.meta.dir, "..")
const media = resolve(site, "..", "media")
const chrome = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const only = process.argv.slice(2)

const run = (cmd: string, args: string[]) =>
  new Promise<void>((done, fail) =>
    spawn(cmd, args, { stdio: "inherit" }).on("exit", (code) => (code === 0 ? done() : fail(new Error(`${cmd} exited ${code}`)))),
  )

/** The hero restarts on its own clock: wait for a fresh loop, at its second zero. */
async function heroZero(page: Page, loop: number) {
  await page.waitForFunction(() => document.getElementById("hero-work")?.textContent === "working 1s", undefined, { polling: 20 })
  await page.waitForFunction(() => document.getElementById("hero-work")?.textContent === "working 0s", undefined, { polling: 20, timeout: (loop + 5) * 1000 })
}

async function capture(browser: Awaited<ReturnType<typeof chromium.launch>>, gif: Gif) {
  const scratch = mkdtempSync(join(tmpdir(), `cockpit-${gif.name}-`))
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
    await page.goto(`http://localhost:${PORT}/${gif.page}`, { waitUntil: "networkidle" })
    // the window alone: no nav over it, no labels beside it, the pointer nowhere near it
    await page.evaluate((selector) => {
      document.documentElement.style.scrollBehavior = "auto"
      for (const el of document.querySelectorAll<HTMLElement>(".nav, .callout, header")) el.style.display = "none"
      const win = document.querySelector<HTMLElement>(selector)!
      scrollTo(0, win.getBoundingClientRect().top + scrollY - 40)
    }, gif.window)
    const win = page.locator(gif.window).first()
    if (gif.name === "hero") await heroZero(page, gif.loop)
    else await page.waitForTimeout(1500)
    const frames: { file: string; at: number }[] = []
    const start = Date.now()
    while (Date.now() - start < gif.loop * 1000) {
      const file = join(scratch, `${String(frames.length).padStart(4, "0")}.png`)
      const at = Date.now() - start
      await win.screenshot({ path: file })
      frames.push({ file, at })
      await page.waitForTimeout(Math.max(0, (frames.length * 1000) / FPS - (Date.now() - start)))
    }
    await page.close()
    // each frame lasts until the next was taken
    const list = frames
      .map((frame, i) => `file '${frame.file}'\nduration ${(((frames[i + 1]?.at ?? gif.loop * 1000) - frame.at) / 1000).toFixed(3)}`)
      .join("\n")
    const concat = join(scratch, "frames.txt")
    await Bun.write(concat, `${list}\nfile '${frames.at(-1)!.file}'\n`)
    const out = join(media, `${gif.name}.gif`)
    await run("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", concat, "-vf",
      `fps=${FPS},scale=${Number(process.env.WIDTH ?? gif.width)}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=${Number(process.env.COLORS ?? 256)}:stats_mode=full[p];[b][p]paletteuse=dither=none:diff_mode=rectangle`, out])
    console.log(`wrote media/${gif.name}.gif — ${frames.length} frames, ${((Bun.file(out).size) / 1024).toFixed(0)} KB`)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

const preview = spawn("bunx", ["astro", "preview", "--port", String(PORT)], { cwd: site, stdio: "ignore" })
try {
  await new Promise((wait) => setTimeout(wait, 3000))
  const browser = await chromium.launch({ executablePath: chrome, headless: true })
  for (const gif of GIFS) if (only.length === 0 || only.includes(gif.name)) await capture(browser, gif)
  await browser.close()
} finally {
  preview.kill()
}
