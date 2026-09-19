/**
 * Every word on the landing page. Components render this; none of them hold copy of their own, so
 * changing the pitch never means touching markup.
 */
export const nav = {
  links: [
    { label: "Why", href: "#why" },
    { label: "Platform", href: "#platform" },
    { label: "Bays", href: "#bays" },
    { label: "Demo", href: "#demo" },
    { label: "Install", href: "#install" },
  ],
  version: "v0.3.0",
  github: "https://github.com/Codestz/opencode-cockpit",
}

export const hero = {
  eyebrow: "// instruments for OpenCode",
  title: ["Give your agent a", "flight deck", ", not another tool call."] as const,
  body:
    "Cockpit is a platform for OpenCode capabilities: one daemon that owns long-lived state, one " +
    "config for both halves of a plugin, and real estate in the interface. Two bays are fitted: " +
    "background terminals that keep running and report their own health, and a statusline that tells " +
    "you what the session is actually costing you.",
  install: "opencode plugin opencode-cockpit --global",
  /** The panel, as it looks while a session is running. */
  deck: {
    caption: "SHELLS — THIS PROJECT",
    slots: [
      { state: "run", name: "Vite dev server", detail: "· :5173", meta: "4m 12s" },
      { state: "warn", name: "tsc --watch", detail: "· 1 error", meta: "11m 02s" },
      { state: "run", name: "vitest --watch", detail: "· 26 passed", meta: "6m 40s" },
    ],
    lines: [
      '<span class="d">// unprompted, four minutes into the session</span>',
      "",
      '<span class="w">⚠ tsc: ok → fail</span>',
      "  src/checkout/total.ts:42 — TS2339 Property 'id' does not exist",
      "",
      '<span class="a">›</span> shell_read <span class="b">id</span>=sh_9wq2f1ab <span class="b">after</span>=2481 <span class="b">grep</span>="error TS"',
      '<span class="d">  2 lines, 180 tokens — not the whole log</span>',
    ],
  },
}

export const specs = [
  { value: "1", label: "daemon, shared by every window" },
  { value: "9", label: "agent tools" },
  { value: "35", label: "watch presets" },
  { value: "14", label: "statusline segments" },
]

export const compare = {
  number: "01",
  kicker: "The problem",
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
  number: "02",
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

export const bays = {
  number: "03",
  kicker: "Capability bays",
  title: "Fit the suite, or a single instrument.",
  intro:
    "Every bay is its own npm package with a switch in config. They share the daemon, so the second " +
    "one costs nothing.",
  items: [
    {
      id: "shell",
      name: "Shell",
      tagline: "Background terminals",
      state: "live",
      status: "Available · v0.3.0",
      blurb:
        "Background terminals with a real PTY — the things a tool call cannot hold: dev servers, watchers, " +
        "test suites, REPLs, tunnels.",
      points: [
        "Waits on a port, a pattern, silence or exit",
        "Watchers report transitions, not noise",
        "Three views: agent log, your screen, raw replay",
        "Search the scrollback from the console",
        "Time and idle limits, with the reason recorded",
        "Reuses a finished shell instead of piling up",
      ],
      foot: ["9 agent tools", "35 watch presets", "@opencode-cockpit/shell"],
    },
    {
      id: "status",
      name: "Statusline",
      tagline: "Session state, at a glance",
      state: "live",
      status: "Available · v0.3.0",
      blurb:
        "A line of live session state under your conversation: how full the context is, where the tokens " +
        "went, what changed, how long it has taken.",
      points: [
        "A capacity bar that means something at a glance",
        "Tokens split into cache, input and output",
        "Fourteen segments, or write your own in TypeScript",
        "Your Claude Code statusline script runs unchanged",
        "Colours follow whatever theme you run",
        "Nothing shown that the host already says better",
      ],
      foot: ["14 segments", "2 surfaces", "@opencode-cockpit/status"],
    },
    {
      id: "review",
      name: "Review",
      tagline: "Read the diff like a pull request",
      state: "next",
      status: "Next up",
      blurb:
        "A turn ends and you read the whole diff at once, or you read none of it and hope. This bay puts a " +
        "review in the terminal: comment, mark read, suggest — then send it all back at once.",
      points: [
        "Comment on a line, a hunk or a whole file",
        "Mark a file read, so the next turn starts smaller",
        "Suggest a change instead of describing it",
        "Revert one part without discarding the turn",
        "Send the review as a single message",
        "Built on session.diff, which carries before and after",
      ],
      foot: ["planned", "design open", "@opencode-cockpit/review"],
    },
    {
      id: "open",
      name: "Open bay",
      tagline: "Proposals welcome",
      state: "open",
      status: "Proposals welcome",
      blurb:
        "The airframe takes more instruments than these. Ideas on the table, none of them started — the " +
        "strongest case wins the slot.",
      points: [
        "Checkpoints you can roll back to",
        "A context and cost meter",
        "Ports and services, seen at a glance",
        "Scheduled and recurring prompts",
        "Shared memory between sessions",
        "Yours — open an issue",
      ],
      foot: ["MIT", "one package per bay", "open an issue"],
    },
  ],
}

export const demo = {
  number: "04",
  kicker: "Recorded, not mocked up",
  title: "A real session, not a storyboard.",
  intro:
    "The first clip is an unedited model turn: a question, the agent reaching for <code>shell_start</code> " +
    "by itself, the panel filling underneath, and the answer coming back. Recorded by a script in the " +
    "repository that drives a real OpenCode, so a demo can never drift from what ships.",
  clips: [
    { cast: "session", label: "A real conversation", hint: "ask → shell_start → answer", caption: "tapes/session.ts · a real model turn, start to finish" },
    { cast: "dock", label: "Panel under the chat", hint: "dev server, live", caption: "tapes/dock.ts · the panel and the console, at full size" },
    { cast: "search", label: "Search a long log", hint: "240 lines → 4", caption: "tapes/search.ts · filtering happens in the daemon" },
    { cast: "tour", label: "Two shells at once", hint: "two shells, one keyboard", caption: "tapes/tour.ts · switching without the mouse" },
  ],
}

export const install = {
  number: "05",
  kicker: "Install",
  title: "Two minutes, then ask it to start something.",
  modes: [
    {
      id: "all",
      label: "Everything",
      command: "opencode plugin opencode-cockpit --global",
      note:
        'All bays, each with a switch: <code>{ "features": { "shell": true } }</code>. New bays arrive with ' +
        "an update and stay off until you turn them on.",
    },
    {
      id: "one",
      label: "Shell only",
      command: "opencode plugin @opencode-cockpit/shell --global",
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
