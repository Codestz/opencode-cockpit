import cockpit from "../../../packages/opencode/package.json" with { type: "json" }

/**
 * Every word on the landing page. Components render this; none of them hold copy of their own, so
 * changing the pitch never means touching markup.
 *
 * The version is the published package's, read at build: a number typed here was wrong for two
 * releases once, and this one is in every install command on the page.
 */
export const version = cockpit.version

export const github = "https://github.com/Codestz/opencode-cockpit"

/** OpenCode 1 writes both config files; OpenCode 2 reads one, and its background service must restart. */
export const install = {
  v1: { label: "OpenCode 1", command: `opencode plugin opencode-cockpit@${version} --global --force` },
  v2: {
    label: "OpenCode 2",
    command: `opencode plugin add opencode-cockpit@${version}`,
    after: "opencode service restart",
    afterNote: "after installing, and after every update",
  },
  requires: "OpenCode 1.18+ or 2.0.15+ · macOS and Linux · MIT",
  pinned: "Pinned on purpose: OpenCode resolves a plugin once. The same line moves you to a newer release.",
}

export const nav = [
  { label: "Bays", href: "#bays" },
  { label: "Trail", href: "#trail" },
  { label: "Docs", href: "start/what-cockpit-is/" },
  { label: "Changelog", href: "help/changelog/" },
]

export const hero = {
  /** Under the window: what makes it more than a picture of the product. */
  proof: "Drawn live by Cockpit's own code — the same renderers that run in your terminal.",
  tag: `${version} — Trail: what every conversation shipped`,
  title: "Your agent, on instruments.",
  accent: "See it work while it works.",
  body:
    "Cockpit adds the instruments OpenCode doesn't ship with: shells that keep running, subagents you " +
    "can watch, a pull request in the terminal, and a trail of everything each conversation made.",
}

/** The strip under the hero: one cell per bay, each a link to its section. */
export const bays = [
  { id: "trail", name: "Trail", what: "what it shipped" },
  { id: "shell", name: "Shell", what: "background runs" },
  { id: "subagents", name: "Subagents", what: "helpers, visible" },
  { id: "review", name: "Review", what: "PRs in the terminal" },
  { id: "status", name: "Status", what: "context & cost" },
  { id: "trust", name: "Trust", what: "fewer prompts" },
  { id: "updater", name: "Updater", what: "what plugins run" },
]

export const trail = {
  eyebrow: `TRAIL · NEW IN ${version.split(".").slice(0, 2).join(".")}`,
  title: "Know what every conversation shipped.",
  accent: "And which one shipped it.",
  steps: [
    {
      title: "The agent records what it makes",
      body: "A PR, a ticket, a deploy: one `trail_add` call as it happens. No setup, no scanning your history.",
    },
    {
      title: "It's in the sidebar, as it happens",
      body: "Grouped under what it was for — a PR under its ticket — with how long ago, and `↗` where there's a page to open.",
    },
    {
      title: "`/trail` is the whole list",
      body: "Every record, its system, what was done to it. `enter` opens it, `c` copies, `/` searches.",
    },
    {
      title: "Any record leads back to its conversation",
      body: "`tab` to every conversation in the project, then `g` on any line: you're back in the session that made it.",
    },
  ],
}

export interface Feature {
  id: string
  eyebrow: string
  title: string
  accent: string
  body: string
  points: { key: string; text: string }[]
  caption: string
  /** Character size in the window: a wide pane is drawn smaller so it keeps its columns. */
  size?: number
}

export const features: Feature[] = [
  {
    id: "shell",
    eyebrow: "02 · SHELL",
    title: "Long things run in the background.",
    accent: "The agent waits on them. You watch.",
    body:
      "A tool call has to finish; a dev server never does. Shell gives the agent real terminals that outlive " +
      "the turn, wait for a port or a pattern, and hand back the part that matters.",
    points: [
      { key: "ctrl+x o", text: "the shells panel, under the chat" },
      { key: "ctrl+x j", text: "the last shell's console" },
      { key: "34", text: "watch presets — a port, a log line, a crash" },
    ],
    caption: "ctrl+x j · shells",
    size: 11.5,
  },
  {
    id: "subagents",
    eyebrow: "03 · SUBAGENTS",
    title: "Helpers work in parallel.",
    accent: "Now you can watch them.",
    body:
      "A subagent used to be one line in the chat. Now each one is in the sidebar with what it's doing right " +
      "now — and a key opens its whole run: the task, its thinking, every command and its output.",
    points: [
      { key: "ctrl+x d", text: "the subagent working now, beside the chat" },
      { key: "m", text: "message it yourself — the main agent is told" },
      { key: "b", text: "send a blocking one to the background" },
    ],
    caption: "ctrl+x d · explore",
  },
  {
    id: "review",
    eyebrow: "04 · REVIEW",
    title: "Review changes like a pull request.",
    accent: "In the terminal, images included.",
    body:
      "Comment on the lines you mean, not in prose. The agent reads your notes, fixes the code and resolves " +
      "them — and a resolve over an untouched file stays open.",
    points: [
      { key: "ctrl+x v", text: "the review of what changed" },
      { key: "c", text: "a note on this line, then s to hand them over" },
      { key: "ctrl+x k", text: "right pane or full screen" },
    ],
    caption: "ctrl+x v · changes",
    size: 10.5,
  },
  {
    id: "status",
    eyebrow: "05 · STATUS",
    title: "See the context filling.",
    accent: "Before it bites.",
    body:
      "How full is the window, where did the tokens go, what has changed, what is it costing. A table in the " +
      "sidebar or one line under the prompt — every part a segment you can reshape.",
    points: [
      { key: "23", text: "segments, or write your own in TypeScript" },
      { key: "/status-setup", text: "the agent designs it with you" },
      { key: "75% · 90%", text: "colour only when it's worth one" },
    ],
    caption: "Status",
  },
  {
    id: "trust",
    eyebrow: "06 · TRUST",
    title: "Stop answering the same prompt.",
    accent: "Trust learns what you always allow.",
    body:
      "Approve `bun test` three times and Trust answers it for you. Risky commands take more, and nothing it " +
      "learns lasts forever. Every answer it gave is one key away.",
    points: [
      { key: "ctrl+x p", text: "what Trust answered, and why" },
      { key: "3×", text: "allowed, then earned — dangerous ones take more" },
      { key: "30d", text: "trust you don't use expires" },
    ],
    caption: "ctrl+x p · Trust",
  },
  {
    id: "updater",
    eyebrow: "07 · UPDATER",
    title: "Every plugin, and what it's",
    accent: "really running.",
    body:
      "`@latest` means the newest release the day you installed it. Updater shows what runs beside what's " +
      "published, and updates the ones you pick — every plugin, not just this one.",
    points: [
      { key: "/plugins-update", text: "inside OpenCode" },
      { key: "npx opencode-cockpit@latest update", text: "from any shell" },
    ],
    caption: "/plugins-update",
  },
]

export const setup = {
  eyebrow: "SET UP IN ONE SENTENCE",
  title: "Install, then",
  accent: "/cockpit-setup.",
  body:
    "The agent reads your settings, asks only what matters — which bays show, in what order, how quiet when " +
    "empty — and writes the smallest correct file.",
  restart: "Every bay is on. Each one draws its block in the sidebar, or says `none yet` until it has something.",
  chat: [
    ["you", "/cockpit-setup"],
    ["agent", "Read your settings: every bay is on, no notices."],
    ["ask", "Which blocks should the sidebar show, top to bottom?"],
    ["you", "trail, subagents, shells. hide shells when empty"],
    ["agent", "Writing ~/.config/opencode-cockpit/config.json"],
    ["ok", "✓ sidebar: trail · subagents · shell (hideWhenEmpty)"],
  ] as const,
}

export const final = {
  title: "Put your agent",
  accent: "on instruments.",
  links: [
    { label: "Read the docs", href: "start/what-cockpit-is/" },
    { label: "GitHub ↗", href: github },
    { label: "Changelog", href: "help/changelog/" },
  ],
}
