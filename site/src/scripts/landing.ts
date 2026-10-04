/**
 * What moves on the landing page besides the live windows (live.ts): the install tabs, the hero's
 * scripted session, the bay strip, Trail told in four steps, and /cockpit-setup's exchange.
 */
import { setup } from "../data/landing"
import { $, bay, draw, grid, type Line, paint, ready, reduced, type Scene, scenes, visible } from "./live"

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
  const asked: Line[] = [{ text: "Fix COM-1736 and open a PR", kind: "you" }, { text: "trail_add · PR #33 · created", kind: "muted" }]
  const frames: (() => Scene & { go?: boolean })[] = [
    () => ({ caption: "sidebar · Trail — the first record lands", side: one.sidebar(36), chat: asked, flash: true }),
    () => ({ caption: "sidebar · Trail", side: busy.sidebar(36, 8), chat: [...asked, { text: "trail_add · COM-1736 · updated", kind: "muted" }, { text: "trail_add · deploy · staging", kind: "muted" }] }),
    () => ({ caption: "/trail · This conversation", rows: busy.dialog({ width: cols(), height: 22 }).rows }),
    () => {
      // the project sample: records touched by more than one conversation, and g live on each of them
      const project = trail.sample("project")
      const all = project.dialog({ width: cols(), height: 22, tab: "all" })
      const pick = all.items.find((i: { key: string }) => project.dialog({ width: cols(), height: 22, tab: "all", selected: i.key }).target.go)
      return { caption: "/trail · All conversations — g goes there", rows: project.dialog({ width: cols(), height: 22, tab: "all", selected: pick?.key }).rows, go: true }
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
ready().then(() => {
  hero()
  strip()
  story()
  scenes()
  setupChat()
})
