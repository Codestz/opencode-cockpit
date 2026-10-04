/**
 * The live windows: the bays' own renderers (public/engine, built from site/engine by
 * scripts/engine.ts) drawn into a terminal-styled window, and a player per scene deciding what to
 * draw when. The landing page and the docs (<Live scene="…" />) both use it.
 *
 * A bay's module is fetched as its window nears the screen, a window plays only while it is on screen
 * (from the top, each time), holds while hovered, and nothing animates while the tab is hidden. With
 * reduced motion each window shows one settled frame.
 */
import { version } from "../data/landing"

export type Rows = readonly unknown[]
type Paint = (rows: Rows) => string

// Node's path polyfill (Trust) can reach for process.cwd(); a page has no process.
;(globalThis as { process?: unknown }).process ??= { cwd: () => "/", env: {} }

export const base = import.meta.env.BASE_URL
export const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches
export const $ = (id: string) => document.getElementById(id) as HTMLElement
const cache = new Map<string, Promise<any>>()
/** A module from public/engine, fetched once. */
export const engine = (path: string) => {
  if (!cache.has(path)) cache.set(path, import(/* @vite-ignore */ `${base}engine/${path}.js`))
  return cache.get(path)!
}
export const bay = (name: string) => engine(`bays/${name}`)
let painter: Paint = () => ""
/** Rows → HTML, once the engine's paint module has loaded (`ready`). */
export const paint: Paint = (rows) => painter(rows)
/** Loads the painter; everything that draws waits on this. */
export const ready = () => engine("paint").then((mod) => (painter = mod.paint))
export const visible = () => document.visibilityState === "visible"

/** Columns and rows that fit an element, measured from the font it will be drawn in. */
export function grid(el: HTMLElement, size: number) {
  const probe = document.createElement("span")
  probe.className = "term"
  probe.style.cssText = `position:absolute;visibility:hidden;font-size:${size}px`
  probe.textContent = "M".repeat(20)
  // measured inside the page, where the terminal font is set — not in the body's fallback
  ;(el.closest(".deck-page, .live") ?? document.body).append(probe)
  const cell = probe.getBoundingClientRect().width / 20
  probe.remove()
  return {
    cols: Math.max(40, Math.floor((el.clientWidth - 12) / cell)),
    rows: Math.max(8, Math.floor((el.clientHeight - 28) / (size * 1.35))),
  }
}

/* ── drawing a frame: rows, or a sidebar beside a quiet chat, and what sits over it ── */
/** A chat line: what you said (`you`), what the agent did, what answered it. */
export type Line = { text: string; kind?: "you" | "ok" | "trust" | "ask" | "muted" }
export type Scene = { caption?: string; rows?: Rows; side?: Rows; bottom?: Rows; chat?: Line[]; overlay?: string; flash?: boolean }

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;")
export function draw(term: HTMLElement, scene: Scene) {
  const overlay = scene.overlay ? `<div class="overlay">${scene.overlay}</div>` : ""
  if (!scene.side) {
    term.innerHTML = paint(scene.rows ?? []) + overlay
    return
  }
  const chat = (scene.chat ?? []).map((line) => `<div class="${line.kind ?? ""}">${esc(line.text)}</div>`).join("")
  term.innerHTML =
    `<div class="split"><div class="ghost">${chat}<div class="fill"></div>` +
    `<div class="prompt">› ask anything${scene.bottom ? `<div class="term">${paint(scene.bottom)}</div>` : ""}</div>${overlay}</div>` +
    `<div class="sidepane term${scene.flash ? " lit" : ""}">${paint(scene.side)}</div></div>`
}

/* ── one player per bay ─────────────────────────────────────────────────────
 * A player is made when its section comes into view (so it starts from the top), draws a frame for
 * any second `t`, and loops every `loop` seconds. `start` puts the first frame mid-action, so a
 * window is never empty when it appears; `rest` is the one frame shown under reduced motion.
 */
type Size = { cols: number; rows: number }
interface Player {
  loop: number
  start?: number
  rest: number
  frame(t: number, size: Size, spin: number): Scene
}
const phase = (t: number, each: number, n: number) => Math.floor(t / each) % n
const typed = (text: string, from: number, t: number, cps = 22) => text.slice(0, Math.max(0, Math.floor((t - from) * cps)))

/** The bays a scene draws from, when it is not just the one it is named for. */
const NEEDS: Record<string, string[]> = {
  setup: ["trail", "subagents", "shell"],
  "shell-search": ["shell"],
  "trail-dialog": ["trail"],
  "trust-ledger": ["trust"],
}
const needs = (scene: string) => NEEDS[scene] ?? [scene]
const load = (scene: string) => Promise.all(needs(scene).map(bay))

const PLAYERS: Record<string, (mod: any, mods: any[]) => Player> = {
  /**
   * The console, live: the dev server streams, `→` moves to the test run — passing files scroll by,
   * then the failure — and `→` again to the build, which prints and finishes. Output arrives a line at
   * a time, and a shell is running until its output is all there.
   */
  shell: (shell) => {
    const parts = [
      { which: "running", from: 0, lines: (t: number) => 8 + t * 3.2, caption: "ctrl+x j · bun run dev — still running, still printing" },
      { which: "failed", from: 6.5, lines: (t: number) => t * 5, caption: "→ · the next shell: the test run" },
      { which: "done", from: 12, lines: (t: number) => t * 2.4, caption: "→ · the next shell: the build" },
    ] as const
    return {
      loop: 17,
      rest: 11,
      frame(t, { cols, rows }, spin) {
        const at = parts.findLastIndex((part) => part.from <= t)
        const part = parts[at]
        const since = t - part.from
        const k = Math.floor(part.lines(since))
        const settled = k >= shell.length(part.which)
        const caption = part.which === "failed" && settled ? "the tests failed — the agent is told once, with the line" : part.which === "done" && settled ? "the build — done, and quiet" : part.caption
        // the key that moved here, shown for a moment
        const overlay = at > 0 && since < 0.9 ? `<div class="keypress"><b>→</b> next shell</div>` : undefined
        return { caption, rows: shell.screen(part.which, cols, rows, spin, shell.NOW + t * 1000, k), overlay }
      },
    }
  },

  subagents: (sub) => ({
    loop: 20,
    rest: 12,
    frame: (t, { cols, rows }, spin) => ({
      caption: "ctrl+x d · explore — Map the authentication flow",
      rows: sub.pane(sub.START + Math.min(10 + t * 2.6, 60) * 1000, cols, rows, spin),
    }),
  }),

  /** A person reviewing: walk, mark viewed, note a line, hand it over, the agent resolves it. Then an image. */
  review: (review) => {
    const each = 1.9
    const walk = review.STEPS.length * each
    return {
      loop: walk + 6,
      start: each,
      rest: 7 * each,
      frame(t, { cols, rows }) {
        if (t >= walk) return { caption: "ctrl+x v · a screenshot: before → after, changed pixels lit", rows: review.image(cols, rows) }
        const i = Math.floor(t / each)
        const step = review.STEPS[i]
        const overlay = step.draft
          ? `<div class="dialog"><div class="head">Note · src/tui/index.tsx · line 1</div><div class="draft">${esc(typed(step.draft, i * each, t))}<i>▍</i></div><div class="keys"><b>[enter]</b> Save   <b>[esc]</b> Cancel</div></div>`
          : undefined
        return { caption: step.caption, rows: review.frame(i, cols, rows), overlay }
      },
    }
  },

  /** One long turn: the window fills, through the gauge's steps, as the table and as the line. */
  status: (status) => ({
    loop: 16,
    start: 1,
    rest: 12.5,
    frame(t, { cols }) {
      const p = Math.min(1, t / 14)
      const caption = p < 0.6 ? "Status — calm: there is room" : p < 0.8 ? "Status — past 75%: worth a look" : "Status — past 90%: compact, or start fresh"
      return {
        caption,
        side: status.table(p, 34),
        bottom: status.line(p, Math.max(40, cols - 46)),
        chat: [
          { text: "Refactor the session store", kind: "you" },
          { text: "Reading src/auth/session.ts…", kind: "muted" },
          ...(p > 0.35 ? [{ text: "Editing 6 files…", kind: "muted" as const }] : []),
          ...(p > 0.7 ? [{ text: "Running the auth tests…", kind: "muted" as const }] : []),
        ],
      }
    },
  }),

  /**
   * Trust learning, as it happens: the agent asks for `bun test`, you allow it — 1/3, 2/3, 3/3 — and
   * the fourth time Trust answers it. Then ctrl+x p shows what it answered, and why.
   */
  trust: (trust) => {
    let engine = trust.live()
    let done = -1
    let chat: Line[] = []
    let asking: { id: string; have: number; need: number } | undefined
    let lit = 0
    const BEATS: [number, () => void][] = [
      [0.2, () => (chat = [{ text: "Run the tests and push", kind: "you" }])],
      ...[0, 1, 2].flatMap((n): [number, () => void][] => [
        [0.8 + n * 2.6, () => {
          const a = engine.ask("bun test")
          const p = a.progress[0]
          asking = { id: a.id, have: p?.have ?? n, need: p?.need ?? 3 }
          chat.push({ text: "$ bun test", kind: "muted" })
        }],
        [2.4 + n * 2.6, () => {
          engine.approve(asking!.id)
          chat.push({ text: `✓ allowed by you · ${n + 1}/3`, kind: "ok" })
          asking = undefined
          lit = 6
        }],
      ]),
      [9.0, () => {
        const a = engine.ask("bun test")
        chat.push({ text: "$ bun test", kind: "muted" }, { text: a.answered ? "✓ answered by Trust — approved by you 3× in a row" : a.why, kind: "trust" })
        lit = 8
      }],
    ]
    return {
      loop: 17,
      rest: 10,
      frame(t, { cols, rows }) {
        if (t < done) {
          engine = trust.live()
          done = -1
          chat = []
          asking = undefined
        }
        for (const [at, act] of BEATS) if (at <= t && at > done) act()
        done = t
        if (t >= 11.5) return { caption: "ctrl+x p · what Trust answered, and why", rows: engine.activity(cols, rows) }
        const flash = lit-- > 0
        const overlay = asking
          ? `<div class="permission"><div class="head">Permission required</div><div class="what"><b>bash</b> bun test</div><div class="learn">Trust: ${asking.have}/${asking.need} toward trusted</div><div class="keys"><b>Allow once</b>   Allow always   Reject</div></div>`
          : undefined
        return { caption: asking ? "the agent asks — you answer" : t > 9 ? "Trust answered it for you" : "sidebar · Trust", side: engine.sidebar(36), chat, overlay, flash }
      },
    }
  },

  updater: (updater) => ({
    loop: 5.6,
    rest: 4.2,
    frame(t, { cols }) {
      const step = phase(t, 1.4, 4)
      return {
        caption: "/plugins-update",
        rows: updater.list(Math.min(cols, 86), step % 2, step >= 2 ? ["opencode-cockpit", "@acme/opencode-lint-rules"] : ["opencode-cockpit"], version),
      }
    },
  }),
  /**
   * /cockpit-setup: the agent reads the settings, asks what matters, writes the file — and the
   * sidebar, drawn by the bays themselves, rearranges: Trail to the top, an empty Shells block gone.
   */
  setup: (_, [trail, sub, shell]) => {
    const busy = trail.sample("busy")
    const at = (t: number) => sub.START + 52_000 + t * 300
    const SAY: [number, Line][] = [
      [0.3, { text: "/cockpit-setup", kind: "you" }],
      [1.6, { text: "Read your settings: every bay is on, nothing from before 0.9.", kind: "muted" }],
      [3.2, { text: "Which blocks should the sidebar show, top to bottom — and should an empty one stay?", kind: "ask" }],
      [5.8, { text: "trail first, then subagents and shells. hide shells when it's empty", kind: "you" }],
      [7.4, { text: "Writing ~/.config/opencode-cockpit/config.json", kind: "muted" }],
      [8.2, { text: '"sidebar": ["trail", "subagents", "shell"], "shell": { "hideWhenEmpty": true }', kind: "muted" }],
      [9.4, { text: "✓ read back with no notices", kind: "ok" }],
    ]
    const WRITTEN = 8.2
    return {
      loop: 16,
      start: 0.5,
      rest: 12,
      frame(t, _size, spin) {
        const written = t >= WRITTEN
        const trailBlock = busy.sidebar(36, 4)
        const subBlock = sub.sidebar(at(t), 36, spin)
        const shellBlock = shell.sidebar([], 0, spin, 36, written)
        const gap = [[{ text: " " }]]
        const side = written ? [...trailBlock, ...gap, ...subBlock] : [...subBlock, ...gap, ...shellBlock, ...gap, ...trailBlock]
        return {
          caption: written ? "the file is written — the sidebar follows it" : "/cockpit-setup — the agent asks only what matters",
          side,
          chat: SAY.filter(([when]) => when <= t).map(([, line]) => line),
          flash: written && t < WRITTEN + 1.2,
        }
      },
    }
  },

  /** The console's search: `/`, a word, enter — the log down to the lines that have it, matches lit. */
  "shell-search": (shell) => {
    const QUERY = "app1"
    return {
      loop: 11,
      start: 0.5,
      rest: 6,
      frame(t, { cols, rows }, spin) {
        if (t < 1.5) return { caption: "the log: every line, numbered", rows: shell.log(cols, rows, spin, {}) }
        if (t < 3.5) return { caption: "/ · search the scrollback", rows: shell.log(cols, rows, spin, { draft: typed(QUERY, 1.8, t, 6) }) }
        return { caption: `enter · only the lines with "${QUERY}", line numbers kept`, rows: shell.log(cols, rows, spin, { filter: QUERY }) }
      },
    }
  },

  /** Trust's ledger: the cursor walks the families and commands, the card says what each answers. */
  "trust-ledger": (trust) => ({
    loop: 16,
    rest: 3.5,
    frame: (t, { cols, rows }) => ({ caption: "l · the ledger: what Trust has learned, and exactly what it answers", rows: trust.ledger("busy", cols, rows, Math.floor(t / 1.6)) }),
  }),

  /** /trail on a busy project: this conversation, then tab to all of them and g on a line. */
  "trail-dialog": (trail) => {
    const busy = trail.sample("busy")
    // every conversation in the project: which ones touched each record, and g on any of them
    const project = trail.sample("project")
    const goable = (cols: number, rows: number) =>
      project
        .dialog({ width: cols, height: rows, tab: "all" })
        .items.filter((item: { key: string }) => project.dialog({ width: cols, height: rows, tab: "all", selected: item.key }).target.go)
    return {
      loop: 12,
      rest: 8,
      frame(t, { cols, rows }) {
        if (t < 5) return { caption: "/trail · This conversation", rows: busy.dialog({ width: cols, height: rows }).rows }
        const items = goable(cols, rows)
        const pick = items[Math.floor((t - 5) / 1.6) % Math.max(1, items.length)]
        return { caption: "tab · every conversation in the project — g goes to the one on the cursor", rows: project.dialog({ width: cols, height: rows, tab: "all", selected: pick?.key }).rows }
      },
    }
  },
}

export function scenes() {
  type Live = { player: Player; t0: number; held?: number }
  const live = new Map<HTMLElement, Live>()
  let spin = 0
  // fetch a bay a screen early; play it only while it is on screen, from the top each time
  const near = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) load((e.target as HTMLElement).dataset.scene!)
  }, { rootMargin: "100% 0px" })
  const seen = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const term = e.target as HTMLElement
      if (!e.isIntersecting) {
        live.delete(term)
        continue
      }
      term.closest(".feature")?.classList.add("seen")
      load(term.dataset.scene!).then((mods) => {
        const player = PLAYERS[term.dataset.scene!](mods[0], mods)
        live.set(term, { player, t0: performance.now() - (player.start ?? 0) * 1000 })
      })
    }
  }, { threshold: 0.2 })
  for (const term of document.querySelectorAll<HTMLElement>("[data-scene]")) {
    near.observe(term)
    seen.observe(term)
    // hold the frame while the pointer is on the window, so it can be read
    const frame = term.closest<HTMLElement>(".window")!
    frame.addEventListener("mouseenter", () => {
      const it = live.get(term)
      if (it) it.held = performance.now()
    })
    frame.addEventListener("mouseleave", () => {
      const it = live.get(term)
      if (it?.held) {
        it.t0 += performance.now() - it.held
        it.held = undefined
      }
    })
  }
  const tick = () => {
    spin++
    if (visible())
      for (const [term, it] of live) {
        const size = Number(term.dataset.size || 12)
        const { player } = it
        const t = reduced ? player.rest : (((it.held ?? performance.now()) - it.t0) / 1000) % player.loop
        const scene = player.frame(t, grid(term.parentElement!, size), spin)
        draw(term, scene)
        const caption = document.querySelector(`[data-caption="${term.dataset.scene}"]`)
        if (caption && scene.caption) caption.textContent = scene.caption
      }
    setTimeout(tick, reduced ? 2000 : 150)
  }
  tick()
}

