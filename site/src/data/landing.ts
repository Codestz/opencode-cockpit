import manifest from "../../../package.json" with { type: "json" }
/**
 * Every word on the landing page. Components render this; none of them hold copy of their own, so
 * changing the pitch never means touching markup.
 */
export const nav = {
  links: [
    { label: "What's fitted", href: "#bays" },
    { label: "Review", href: "#review" },
    { label: "Shell", href: "#shell" },
    { label: "Statusline", href: "#status" },
    { label: "Updater", href: "#updater" },
    { label: "Platform", href: "#platform" },
    { label: "Install", href: "#install" },
  ],
  /**
   * Read from the package rather than typed here.
   *
   * It said v0.3.0 through two releases: a number nobody thinks to update is a number that is
   * wrong, and this one sits in the corner of every page.
   */
  version: `v${manifest.version}`,
  github: "https://github.com/Codestz/opencode-cockpit",
}

export const hero = {
  eyebrow: "// instruments for OpenCode",
  title: ["Give OpenCode the", "instruments", "it does not ship with."] as const,
  body:
    "A tool call has to finish. A dev server does not, and neither does the context window filling " +
    "up behind you. Cockpit is the instrument panel: things your agent can use, and things that " +
    "tell you what it is doing. One package per capability, one switch each.",
  install: "opencode plugin opencode-cockpit@0.5.0 --global --force",
}

export const specs = [
  { value: "1", label: "daemon, shared by every window" },
  { value: "9", label: "agent tools" },
  { value: "35", label: "watch presets" },
  { value: "14", label: "statusline segments" },
]

export const compare = {
  number: "",
  kicker: "Why not just bash",
  title: "A tool call is the wrong shape for work that keeps going.",
  intro:
    "Everything long-running hits the same wall: the call either blocks until the process dies, or " +
    "backgrounds it into the dark. Cockpit changes the shape of the call.",
  columns: ["Bash in a tool call", "A Cockpit shell"],
  rows: [
    ["Blocks the turn until the server is killed", "Returns the moment the port actually answers"],
    ["Backgrounded with & and lost with the session", "Outlives the turn, the session and the window"],
    ['"Is it ready?" answered by sleeping and hoping', "Waits on a port, a pattern, silence or exit"],
    ["A crash nobody notices until the next command", "A process that dies is reported as a failure"],
    ["The whole log re-read every turn, in tokens", "Reads forward from a cursor, greps before it costs"],
  ],
}

export const platform = {
  number: "06",
  kicker: "The platform",
  title: "What every capability inherits.",
  intro:
    "A bay never re-solves process ownership, configuration or interface plumbing. It declares what " +
    "it needs and gets the rest from the airframe.",
  pieces: [
    {
      icon: "daemon",
      title: "A daemon that outlives the session",
      body:
        "OpenCode's interface and server run in separate threads that cannot share memory, and neither " +
        "survives a restart. <code>cockpitd</code> owns the state: shared by every window, self-upgrading, " +
        "reaping what crashes leave behind, exiting when idle.",
    },
    {
      icon: "config",
      title: "One config for both halves",
      body:
        "Agent plugins are configured in <code>opencode.json</code>, interface plugins in <code>tui.json</code>. " +
        "Cockpit reads a single file — global, then project, then plugin entry — and ignores a broken one " +
        "rather than failing.",
    },
    {
      icon: "panel",
      title: "Real estate in the interface",
      body:
        "A docked panel, a full-screen console, a sidebar section, a keymap namespace. A bay asks for the " +
        "slot it needs and inherits the chrome, the theme and the keybind conventions.",
    },
    {
      icon: "wire",
      title: "A typed wire between them",
      body:
        "JSON-RPC over a private socket, schemas shared by client and daemon, versioned at " +
        "<code>protocol 1.3</code>. A bay adds methods and events without the others knowing, and a " +
        "mismatch is reported instead of guessed at.",
    },
  ],
}

/**
 * One entry per bay, in the order they appear down the page.
 *
 * The page is built from this list: a short index at the top, then a section each. Fitting another
 * bay is appending an object here — it was a fixed three-card grid before, which meant a fourth
 * capability would have cost a redesign rather than an entry.
 */
export const bays = {
  number: "01",
  kicker: "What is fitted",
  title: "Four instruments today. One switch each.",
  intro:
    "Every bay is its own npm package with a switch in config. They share the daemon, the config " +
    "file and the keys, so the second costs nothing and moving between them changes nothing you " +
    "have already set up.",
  items: [
    {
      id: "review",
      name: "Review",
      tagline: "A pull request in the terminal",
      state: "live",
      status: "Available",
      gains: { agent: "Comments it can answer and resolve", you: "The diff, with notes on the lines" },
      blurb:
        "Reviewing what an agent wrote means reading a diff in a chat log and describing your " +
        "objection in prose. Review gives you the diff where the work happened, comments on the " +
        "lines they are about, and an agent that can read them, answer them and mark them resolved " +
        "— which a chat message cannot do.",
      points: [
        "Comment on a line, a range, or a whole file",
        "The agent reads them as data, not as prose",
        "A resolve is checked against the file before it counts",
        "Notes live on the branch, so they outlive the chat",
        "The agent can leave notes of its own",
        "Uncommitted, the branch, or just this conversation",
      ],
      foot: ["3 agent tools", "12 filetypes", "@opencode-cockpit/review"],
      docs: "/review/overview/",
      media: {
        kind: "casts" as const,
        clips: [
          {
            cast: "review",
            label: "A review, answered",
            hint: "comment → submit → resolved",
            caption: "tapes/review.ts · a real branch, a real turn — only the waiting is cut",
          },
        ],
      },
    },
    {
      id: "shell",
      name: "Shell",
      tagline: "Background terminals",
      state: "live",
      status: "Available",
      gains: { agent: "Terminals that keep running", you: "A panel that reports its own health" },
      blurb:
        "A tool call has to finish. A dev server does not — so your agent either blocks on it, or " +
        "backgrounds it and loses the output. Shell gives it terminals with a real PTY that outlive " +
        "the turn, wait for a port or a pattern, and hand back the part that matters.",
      points: [
        "Waits on a port, a pattern, silence or exit",
        "Watchers report transitions, not noise",
        "Three views: agent log, your screen, raw replay",
        "Search the scrollback from the console",
        "Time and idle limits, with the reason recorded",
        "Reuses a finished shell instead of piling up",
      ],
      foot: ["9 agent tools", "35 watch presets", "@opencode-cockpit/shell"],
      docs: "/shell/overview/",
      media: {
        kind: "casts" as const,
        clips: [
          { cast: "session", label: "A real conversation", hint: "ask → shell_start → answer", caption: "tapes/session.ts · a real model turn, start to finish" },
          { cast: "dock", label: "Panel under the chat", hint: "dev server, live", caption: "tapes/dock.ts · the panel and the console, at full size" },
          { cast: "search", label: "Search a long log", hint: "240 lines → 4", caption: "tapes/search.ts · filtering happens in the daemon" },
          { cast: "tour", label: "Two shells at once", hint: "two shells, one keyboard", caption: "tapes/tour.ts · switching without the mouse" },
        ],
      },
    },
    {
      id: "status",
      name: "Statusline",
      tagline: "The session, at a glance",
      state: "live",
      status: "Available",
      gains: { agent: "—", you: "What the session is costing you" },
      blurb:
        "How full is the context? Where did the tokens go? What has changed? OpenCode answers the " +
        "first in a corner and the rest not at all. The statusline answers them where you are already " +
        "looking, and every part of it is a segment you can reshape, recolour or write yourself.",
      points: [
        "A capacity bar that means something at a glance",
        "Tokens split into cache, input and output",
        "Fourteen segments, or your own in TypeScript",
        "Your Claude Code statusline script runs unchanged",
        "Colours follow whatever theme you run",
        "Silent about anything the host already says better",
      ],
      foot: ["14 segments", "2 surfaces", "@opencode-cockpit/status"],
      docs: "/status/overview/",
      media: {
        kind: "image" as const,
        src: "/media/statusline.png",
        alt: "The statusline under an OpenCode conversation: a context bar at 40 per cent, the token total with its cache, input and output parts, the session diff, and elapsed time",
        caption: "the default line · no configuration written at all",
      },
    },
    {
      id: "updater",
      name: "Updater",
      tagline: "Every plugin, and what it really runs",
      state: "live",
      status: "Available",
      gains: { agent: "—", you: "Plugins that are actually current" },
      blurb:
        "OpenCode installs a plugin once and never resolves its spec again, so @latest quietly means " +
        "the release that was newest the day you installed it — and nothing says which one that was. " +
        "The Updater shows what is running beside what your config says and what is published, and " +
        "updates what you pick, checking every file afterwards.",
      points: [
        "Every plugin you have, not just this one",
        "Running, config and published, side by side",
        "latest ⚠ — a spec that will not move on its own",
        "Every change shown before anything is written",
        "Pins through OpenCode's own installer",
        "Read back from disk, with the fix for what is not",
      ],
      foot: ["every plugin", "npx … update when stuck", "@opencode-cockpit/updater"],
      docs: "/updater/overview/",
      media: {
        kind: "casts" as const,
        clips: [
          {
            cast: "updater",
            label: "A frozen @latest",
            hint: "found → reviewed → fixed",
            caption: "tapes/updater.ts · real plugins, a real install — only the npm wait is cut",
          },
        ],
      },
    },
  ],
}

/** What is coming, and the reason it is next. */
export const next = {
  number: "07",
  kicker: "What is next",
  title: "One bay at a time, and only what can be built.",
  intro:
    "Nothing is listed here that cannot be built with what OpenCode already exposes. One bay at a " +
    "time, shipped before the next is announced.",
  items: [
    {
      name: "Doctor",
      state: "next",
      blurb:
        "One command that checks your setup and says how to fix it: which halves are loaded, which " +
        "keys collide, whether a daemon is running code older than the plugin that is talking to it.",
      why: "Every answer it needs is already on disk or on the wire; nothing new has to be exposed.",
    },
  ],
}

export const install = {
  number: "08",
  kicker: "Install",
  title: "Two minutes, then ask it to start something.",
  modes: [
    {
      id: "all",
      label: "Everything",
      command: "opencode plugin opencode-cockpit@0.5.0 --global --force",
      note:
        'All bays, each with a switch: <code>{ "features": { "shell": false } }</code>. The version is ' +
        "pinned because OpenCode never re-resolves a plugin — to move later, run " +
        "<code>npx opencode-cockpit@latest update</code>.",
    },
    {
      id: "one",
      label: "Shell only",
      command: "opencode plugin @opencode-cockpit/shell@0.5.0 --global --force",
      note:
        "Just this bay. Same daemon, same config file, same interface slots — add the rest later without " +
        "changing anything you already set up.",
    },
  ],
  steps: [
    "Run the command above — it writes both plugin entries for you.",
    "Restart OpenCode. The daemon starts on first use and exits when idle.",
    "Optional: put kinds, watch presets and defaults in <code>~/.config/opencode-cockpit/config.json</code>.",
  ],
}

export const closing = {
  title: "Stop babysitting your terminal.",
  body: "OpenCode 1.18+ on macOS and Linux. MIT licensed, every bay its own package.",
}
