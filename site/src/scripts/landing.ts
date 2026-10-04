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
  document.body.append(probe)
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

/* ── Trail, as a story: one sticky window, four steps ─────────────────────── */
async function story() {
  const trail = await bay("trail")
  const busy = trail.sample("busy")
  const one = trail.sample("one")
  const screen = document.querySelector<HTMLElement>(".story-screen")!
  const term = $("story-term")
  const cols = () => grid(screen, 12).cols
  const frames = [
    () => ({ caption: "sidebar · Trail — the first record lands", rows: one.sidebar(40) }),
    () => ({ caption: "sidebar · Trail", rows: busy.sidebar(40, 8) }),
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
    $("story-caption").textContent = frame.caption
    term.style.opacity = "0"
    setTimeout(() => {
      term.innerHTML = paint(frame.rows)
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

/* ── one scene per bay: seconds in view, the grid, the spinner → rows ────── */
type Scene = { caption?: string; rows?: Rows; side?: Rows; bottom?: Rows; chat?: string[] }
const phase = (t: number, each: number, n: number) => Math.floor(t / each) % n
const latest = version

const SCENES: Record<string, (mod: any, t: number, size: { cols: number; rows: number }, frame: number) => Scene> = {
  shell: (shell, t, { cols, rows }, frame) => {
    const which = (["running", "failed", "done"] as const)[phase(t, 5, 3)]
    const caption = { running: "ctrl+x j · bun run dev — still running", failed: "ctrl+x j · the test run that failed", done: "ctrl+x j · bun run build — done" }[which]
    return { caption, rows: shell.screen(which, cols, rows, frame, shell.NOW + t * 1000) }
  },
  subagents: (sub, t, { cols, rows }, frame) => ({
    caption: "ctrl+x d · explore — Map the authentication flow",
    rows: sub.pane(sub.START + Math.min(10 + (t % 20) * 2.6, 60) * 1000, cols, rows, frame),
  }),
  review: (review, t, { cols, rows }) =>
    phase(t, 6, 2) === 0
      ? { caption: "ctrl+x v · a note, waiting on the agent", rows: review.noted(cols, rows) }
      : { caption: "ctrl+x v · a PNG: before → after, changes lit", rows: review.image(cols, rows) },
  status: (status, t, { cols }) => {
    // one session filling: calm → busy → nearly full, as the table and as the line
    const fixture = (["working", "busy", "full"] as const)[phase(t, 3, 3)]
    return {
      caption: `Status — ${fixture}`,
      side: status.table(fixture, 34),
      bottom: status.line(fixture, Math.max(40, cols - 46)),
      chat: ["Refactor the session store", "Reading src/auth/session.ts…", "Running the auth tests…"],
    }
  },
  trust: (trust, t, { cols, rows }) =>
    phase(t, 6, 2) === 0
      ? { caption: "ctrl+x p · what Trust answered", rows: trust.activity("busy", cols, rows) }
      : {
          caption: "sidebar · Trust",
          side: trust.sidebar("busy", 36),
          chat: ["Ship the trust bay", "$ git status --short   ✓ answered by Trust", "$ bun test   ✓ answered by Trust", "$ git push origin feat/trust   ○ asks you — 5 of 8"],
        },
  updater: (updater, t, { cols }) => {
    const step = phase(t, 1.4, 4)
    return {
      caption: "/plugins-update",
      rows: updater.list(Math.min(cols, 86), step % 2, step >= 2 ? ["opencode-cockpit", "@acme/opencode-lint-rules"] : ["opencode-cockpit"], latest),
    }
  },
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;")
function draw(term: HTMLElement, scene: Scene) {
  if (!scene.side) {
    term.innerHTML = paint(scene.rows ?? [])
    return
  }
  const [first, ...rest] = scene.chat ?? []
  term.innerHTML =
    `<div class="split"><div class="ghost"><div class="you">${esc(first ?? "")}</div>${rest.map((l) => `<div>${esc(l)}</div>`).join("")}` +
    `<div class="fill"></div><div class="prompt">› ask anything${scene.bottom ? `<div class="term">${paint(scene.bottom)}</div>` : ""}</div></div>` +
    `<div class="sidepane term">${paint(scene.side)}</div></div>`
}

function scenes() {
  const live = new Map<HTMLElement, { t0: number; mod: any }>()
  let frame = 0
  // fetch a bay a screen early, play it only while it is on screen
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
      bay(term.dataset.scene!).then((mod) => live.set(term, { t0: performance.now(), mod }))
    }
  }, { threshold: 0.2 })
  for (const term of document.querySelectorAll<HTMLElement>("[data-scene]")) {
    near.observe(term)
    seen.observe(term)
  }
  const tick = () => {
    frame++
    if (visible())
      for (const [term, { t0, mod }] of live) {
        const size = Number(term.dataset.size || 12)
        const t = reduced ? 0 : (performance.now() - t0) / 1000
        const scene = SCENES[term.dataset.scene!](mod, t, grid(term.parentElement!, size), frame)
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
