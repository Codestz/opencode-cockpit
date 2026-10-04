/**
 * Everything that moves on the landing page. Every terminal row on it is drawn by a bay's own
 * renderer (public/engine, built from site/engine by scripts/engine.ts); this file only decides what
 * to draw when, and where.
 *
 * A bay's module is fetched as its section nears the screen, and nothing animates while the tab is
 * hidden. With reduced motion, each window shows one settled frame and the hero's words arrive whole.
 */
import { setup, version } from "../data/landing"

type Rows = readonly unknown[]
type Paint = (rows: Rows) => string

// Node's path polyfill (Trust) can reach for process.cwd(); a page has no process.
;(globalThis as { process?: unknown }).process ??= { cwd: () => "/", env: {} }

const base = import.meta.env.BASE_URL
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches
const $ = (id: string) => document.getElementById(id) as HTMLElement
const cache = new Map<string, Promise<any>>()
/** A module from public/engine, fetched once. */
const engine = (path: string) => {
  if (!cache.has(path)) cache.set(path, import(/* @vite-ignore */ `${base}engine/${path}.js`))
  return cache.get(path)!
}
const bay = (name: string) => engine(`bays/${name}`)
let paint: Paint = () => ""
const visible = () => document.visibilityState === "visible"

/** Columns and rows that fit an element, measured from the font it will be drawn in. */
function grid(el: HTMLElement, size: number) {
  const probe = document.createElement("span")
  probe.className = "term"
  probe.style.cssText = `position:absolute;visibility:hidden;font-size:${size}px`
  probe.textContent = "M".repeat(20)
  // measured inside the page, where the terminal font is set — not in the body's fallback
  ;(document.querySelector(".deck-page") ?? document.body).append(probe)
  const cell = probe.getBoundingClientRect().width / 20
  probe.remove()
  return {
    cols: Math.max(40, Math.floor((el.clientWidth - 12) / cell)),
    rows: Math.max(8, Math.floor((el.clientHeight - 28) / (size * 1.35))),
  }
}

/* ── install: a tab per OpenCode, remembered; copy ─────────────────────────── */
function installs() {
  let chosen = "v1"
  try {
    chosen = localStorage.getItem("cockpit-opencode") ?? "v1"
  } catch {}
  const show = (tab: string) => {
    for (const box of document.querySelectorAll<HTMLElement>("[data-install]")) {
      for (const b of box.querySelectorAll<HTMLElement>("[data-tab]")) b.setAttribute("aria-selected", String(b.dataset.tab === tab))
      for (const p of box.querySelectorAll<HTMLElement>("[data-panel]")) p.hidden = p.dataset.panel !== tab
    }
  }
  show(chosen)
  document.addEventListener("click", (event) => {
    const target = event.target as HTMLElement
    const tab = target.closest<HTMLElement>("[data-tab]")?.dataset.tab
    if (tab) {
      show(tab)
      try {
        localStorage.setItem("cockpit-opencode", tab)
      } catch {}
    }
    const copy = target.closest<HTMLElement>("[data-copy]")
    if (copy) {
      navigator.clipboard?.writeText(copy.dataset.copy ?? "")
      const was = copy.textContent
      copy.textContent = "Copied"
      setTimeout(() => (copy.textContent = was), 1400)
    }
  })
}

/* ── the hero: one scripted session, Trail and Subagents drawing it live ───── */
/**
 * What a visitor sees in the hero, second by second. `say` is a chat line; `record` is the agent's
 * trail_add, run through Trail's own tool; `shell` moves the background test run — started, failed
 * with its line, run again, passed — and the Shells block draws it.
 */
type Beat = { at: number; say?: [string, string]; record?: Record<string, string>; shell?: "start" | "fail" | "rerun" | "pass" }
const FAILED = "FAIL src/socket.test.ts > resync keeps the version header"
const BEATS: Beat[] = [
  { at: 0.5, say: ["you", "COM-1736 — the bundle desyncs after a reconnect. Fix it and open a PR."] },
  { at: 2.0, say: ["agent", "Starting the tests in the background, and sending two explorers to the socket layer."] },
  { at: 2.8, shell: "start", say: ["tool", "shell_start · bun test · in the background"] },
  { at: 3.4, say: ["tool", "task · explore · Map the authentication flow"] },
  { at: 6.5, record: { title: "Bundle desync", url: "https://acme.atlassian.net/browse/COM-1736", kind: "ticket", action: "updated" } },
  { at: 6.7, say: ["tool", "trail_add · COM-1736 · updated"] },
  { at: 8.5, shell: "fail", say: ["fail", `<shell_exited title="bun test"> exited 1 · ${FAILED}`] },
  { at: 10.0, say: ["agent", "The suite caught it: the retry drops the version header. Patching, then running it again."] },
  { at: 12.0, shell: "rerun", say: ["tool", "shell_restart · bun test · run 2"] },
  { at: 13.0, record: { title: "Retry the socket after sleep", url: "https://linear.app/acme/issue/ENG-42", action: "created", for: "COM-1736" } },
  { at: 15.0, shell: "pass", say: ["pass", "bun test · exited 0 · 212 passed"] },
  { at: 16.5, record: { title: "Fix the bundle desync after reconnect", url: "https://github.com/Codestz/opencode-cockpit/pull/36", action: "created", for: "COM-1736" } },
  { at: 16.7, say: ["tool", "trail_add · PR #36 · created"] },
  { at: 18.0, say: ["agent", "PR #36 is open and the tests are green. Everything this conversation made is in Trail."] },
]
const LOOP = 28

async function hero() {
  const [trail, sub, shell] = await Promise.all([bay("trail"), bay("subagents"), bay("shell")])
  const chat = $("hero-chat")
  const flash = (block: string, callout: string) => {
    $(block).classList.add("flash")
    $(callout).classList.add("hot")
    setTimeout(() => {
      $(block).classList.remove("flash")
      $(callout).classList.remove("hot")
    }, 1400)
  }
  const head = () => {
    chat.innerHTML = `<div class="chat-head"><span><b>Fix the bundle desync</b> · ses_main</span><span>build · claude-opus</span></div>`
  }
  const say = ([kind, text]: [string, string], whole = reduced) => {
    const el = document.createElement("div")
    el.className = `msg ${kind}`
    chat.append(el)
    $("c-chat").classList.add("hot")
    setTimeout(() => $("c-chat").classList.remove("hot"), 900)
    if (kind !== "agent" || whole) {
      el.textContent = text
      return
    }
    // words arrive the way a model streams them, the cursor where they land
    const words = text.split(" ")
    let i = 0
    el.classList.add("streaming")
    const next = () => {
      el.textContent = words.slice(0, ++i).join(" ")
      if (i < words.length) setTimeout(next, 45 + Math.random() * 60)
      else el.classList.remove("streaming")
    }
    next()
  }

  let state = trail.emptyState()
  // the dev server has been up for a while; the test run is what the session starts
  const T = (t: number) => trail.SAMPLE_NOW + t * 1000
  const dev = shell.devServer(T(-300))
  let tests: unknown
  const moveShell = (step: Beat["shell"], t: number) => {
    if (step === "start") tests = shell.testRun(1, T(t))
    if (step === "fail") tests = shell.testRun(1, T(2.8), { at: T(t), failed: FAILED })
    if (step === "rerun") tests = shell.testRun(2, T(t))
    if (step === "pass") tests = shell.testRun(2, T(12), { at: T(t) })
    flash("b-shell", "c-shell")
  }
  let beat = 0
  let t0 = performance.now()
  let frame = 0
  let warned = false
  head()

  // Reduced motion: the session as it ends, once.
  if (reduced) {
    for (const b of BEATS) {
      if (b.record) trail.add(state, b.record, trail.SAMPLE_NOW)
      if (b.shell) moveShell(b.shell, b.at)
      if (b.say) say(b.say, true)
    }
  }

  const deck = document.querySelector<HTMLElement>(".deck")!
  const place = () => {
    for (const callout of deck.querySelectorAll<HTMLElement>(".callout[data-for]")) {
      const block = $(callout.dataset.for!).getBoundingClientRect()
      callout.style.top = `${block.top - deck.getBoundingClientRect().top + Math.min(block.height / 2, 14) - 7}px`
    }
  }
  const tick = () => {
    if (visible()) {
      const t = reduced ? 18 : (performance.now() - t0) / 1000
      if (t > LOOP) {
        state = trail.emptyState()
        tests = undefined
        beat = 0
        t0 = performance.now()
        warned = false
        head()
      }
      const now = trail.SAMPLE_NOW + t * 1000
      while (!reduced && beat < BEATS.length && BEATS[beat].at <= t) {
        const b = BEATS[beat++]
        if (b.record) {
          trail.add(state, b.record, now)
          flash("b-trail", "c-trail")
        }
        if (b.shell) moveShell(b.shell, t)
        if (b.say) {
          say(b.say)
          if (b.say[1].startsWith("task")) flash("b-sub", "c-sub")
        }
      }
      // the oldest lines leave from under the header, as a terminal scrolls
      while (chat.scrollHeight > chat.clientHeight + 4 && chat.children.length > 2) chat.children[1].remove()
      $("hero-shell").innerHTML = paint(shell.sidebar(tests ? [dev, tests] : [dev], now, frame, 38))
      $("hero-sub").innerHTML = paint(sub.sidebar(sub.START + Math.min(t * 3.4, 60) * 1000, 38, frame++))
      $("hero-trail").innerHTML = paint(trail.sidebar(state, trail.SAMPLE_SESSION, 38, now))
      const pct = Math.min(88, 12 + t * 3.2)
      $("hero-gauge").style.width = `${pct}%`
      $("hero-gauge").style.background = pct >= 75 ? "var(--tn-warning)" : "var(--tn-success)"
      $("hero-ctx").textContent = `${Math.round(pct)}%`
      $("hero-ctx").style.color = pct >= 75 ? "var(--tn-warning)" : ""
      if (pct >= 75 && !warned) {
        warned = true
        flash("b-status", "c-status")
      }
      $("hero-work").textContent = `working ${Math.floor(t)}s`
      place()
    }
    if (!reduced) setTimeout(tick, 120)
  }
  tick()
}

/** The strip under the hero: the bays light one after another, a hint of how many there are. */
function strip() {
  if (reduced) return
  const cells = [...document.querySelectorAll<HTMLElement>(".bay")]
  let lit = 0
  setInterval(() => {
    if (!visible()) return
    cells.forEach((cell, i) => cell.classList.toggle("on", i === lit))
    lit = (lit + 1) % cells.length
  }, 1600)
}

/* ── drawing a frame: rows, or a sidebar beside a quiet chat, and what sits over it ── */
/** A chat line: what you said (`you`), what the agent did, what answered it. */
type Line = { text: string; kind?: "you" | "ok" | "trust" | "ask" | "muted" }
type Scene = { caption?: string; rows?: Rows; side?: Rows; bottom?: Rows; chat?: Line[]; overlay?: string; flash?: boolean }

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;")
function draw(term: HTMLElement, scene: Scene) {
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

/* ── Trail, as a story: one sticky window, four steps ─────────────────────── */
async function story() {
  const trail = await bay("trail")
  const busy = trail.sample("busy")
  const one = trail.sample("one")
  const screen = document.querySelector<HTMLElement>(".story-screen")!
  const term = $("story-term")
  const cols = () => grid(screen, 12).cols
  const asked: Line[] = [{ text: "Fix COM-1736 and open a PR", kind: "you" }, { text: "trail_add · PR #33 · created", kind: "muted" }]
  const frames: (() => Scene & { go?: boolean })[] = [
    () => ({ caption: "sidebar · Trail — the first record lands", side: one.sidebar(36), chat: asked, flash: true }),
    () => ({ caption: "sidebar · Trail", side: busy.sidebar(36, 8), chat: [...asked, { text: "trail_add · COM-1736 · updated", kind: "muted" }, { text: "trail_add · deploy · staging", kind: "muted" }] }),
    () => ({ caption: "/trail · This conversation", rows: busy.dialog({ width: cols(), height: 22 }).rows }),
    () => {
      const all = busy.dialog({ width: cols(), height: 22, tab: "all" })
      const pick = all.items.find((i: { kind: string }) => i.kind === "touch") ?? all.items[2]
      return { caption: "/trail · All conversations — g goes there", rows: busy.dialog({ width: cols(), height: 22, tab: "all", selected: pick?.key }).rows, go: true }
    },
  ]
  let goTimer = 0
  const show = (i: number) => {
    document.querySelectorAll<HTMLElement>(".step").forEach((el) => el.classList.toggle("on", Number(el.dataset.step) === i))
    document.querySelectorAll(".progress i").forEach((el, k) => el.classList.toggle("on", k <= i))
    const frame = frames[i]()
    $("story-caption").textContent = frame.caption ?? ""
    term.style.opacity = "0"
    setTimeout(() => {
      draw(term, frame)
      term.style.opacity = "1"
    }, reduced ? 0 : 160)
    clearTimeout(goTimer)
    $("story-go").classList.remove("on")
    if (frame.go) goTimer = window.setTimeout(() => $("story-go").classList.add("on"), reduced ? 0 : 1100)
  }
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) if (entry.isIntersecting) show(Number((entry.target as HTMLElement).dataset.step))
  }, { rootMargin: "-45% 0px -45% 0px" })
  document.querySelectorAll(".step").forEach((el) => io.observe(el))
  show(0)
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

const PLAYERS: Record<string, (mod: any) => Player> = {
  shell: (shell) => ({
    loop: 15,
    rest: 0,
    frame(t, { cols, rows }, spin) {
      const which = (["running", "failed", "done"] as const)[phase(t, 5, 3)]
      const caption = { running: "ctrl+x j · bun run dev — still running", failed: "ctrl+x j · the test run that failed", done: "ctrl+x j · bun run build — done" }[which]
      return { caption, rows: shell.screen(which, cols, rows, spin, shell.NOW + t * 1000) }
    },
  }),

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
}

function scenes() {
  type Live = { player: Player; t0: number; held?: number }
  const live = new Map<HTMLElement, Live>()
  let spin = 0
  // fetch a bay a screen early; play it only while it is on screen, from the top each time
  const near = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) bay((e.target as HTMLElement).dataset.scene!)
  }, { rootMargin: "100% 0px" })
  const seen = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const term = e.target as HTMLElement
      if (!e.isIntersecting) {
        live.delete(term)
        continue
      }
      term.closest(".feature")?.classList.add("seen")
      bay(term.dataset.scene!).then((mod) => {
        const player = PLAYERS[term.dataset.scene!](mod)
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

/* ── /cockpit-setup, as a short exchange ───────────────────────────────── */
function setupChat() {
  const box = $("setup-chat")
  const lines = setup.chat
  let at = 0
  const play = () => {
    if (at % lines.length === 0) box.innerHTML = ""
    const [kind, text] = lines[at % lines.length]
    const el = document.createElement("div")
    el.className = kind
    el.textContent = text
    box.append(el)
    at++
    if (!reduced) setTimeout(play, at % lines.length === 0 ? 4000 : 1300)
    else if (at < lines.length) play()
  }
  const io = new IntersectionObserver(([e]) => {
    if (!e.isIntersecting) return
    io.disconnect()
    play()
  }, { threshold: 0.4 })
  io.observe(box)
}

installs()
engine("paint").then((mod) => {
  paint = mod.paint
  hero()
  strip()
  story()
  scenes()
  setupChat()
})
