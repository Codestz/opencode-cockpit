import { KEYS, type Tape } from "../scripts/record.ts"

/**
 * What a conversation made, and finding it again from another one.
 *
 *   bun run build
 *   bun scripts/record.ts tapes/trail.ts               # OpenCode 2, a packed install, ~4 min
 *   bun scripts/trim.ts tapes/trail.cast --drop 3.2-31.6 --drop 36.2-40.2 --drop 44-53.4 \
 *     --drop 162.8-171.3 --gap 0.4                     # the published take's cuts; find yours
 *   bun scripts/tighten.ts tapes/trail.cast 2
 *   agg --font-size 12 --theme asciinema --fps-cap 1 --idle-time-limit 2 --last-frame-duration 4 \
 *     tapes/trail.cast /tmp/trail.gif
 *   ffmpeg -i /tmp/trail.gif -vf "split[a][b];[a]palettegen=max_colors=32:stats_mode=full[p];[b][p]paletteuse=dither=none" media/trail.gif
 *
 * The still, media/trail.png, is the moment the record lands in the sidebar:
 *   agg --font-size 20 --theme asciinema --idle-time-limit 2 --select 11.5 tapes/trail.cast /tmp/still.gif
 *   ffmpeg -i /tmp/still.gif media/trail.png
 *
 * Small font, one frame a second and 32 colours: every frame is a screenful of text, and that is
 * what keeps the GIF under half a megabyte. The site plays the cast itself, at full quality.
 *
 * The agent is asked to fix a ticket's bug and open a PR. Nothing in the prompt mentions Trail: the
 * `trail_add` that puts the PR in the sidebar is the agent's own, from what its system prompt says.
 * A take where the model did not record it, or never opened the PR, is a take to throw away — not one
 * to patch. A second conversation then asks what shipped for the ticket, and the answer comes from
 * `trail_list`; `/trail` across all conversations, and `g`, lead back to the one that made it.
 *
 * `gh` is a stub on PATH that prints the PR's link, the remote is a bare repository beside the
 * project, and links open in nothing (`COCKPIT_OPENER`). The model is the free Zen one; every
 * keystroke and every tool call is live. Where the turns end moves with the model, so check the
 * cuts with scripts/frame.ts before publishing.
 */

const BUNDLE = `export interface Line {
  sku: string
  price: number
  quantity: number
}

/** A bundle sells its lines together for less. Prices are in minor units. */
export interface Bundle {
  lines: Line[]
  percentOff: number
}

export function bundlePrice(bundle: Bundle): number {
  let sum = 0
  for (const line of bundle.lines) {
    const discounted = line.price - Math.round((line.price * bundle.percentOff) / 100)
    sum += discounted * line.quantity
  }
  // the bundle discount, applied to the total
  return sum - Math.round((sum * bundle.percentOff) / 100)
}
`

/** Says what the real one says on success, and nothing else is asked of it here. */
const GH = `#!/bin/bash
case "$1 $2" in
  "pr create")
    branch=$(git rev-parse --abbrev-ref HEAD)
    echo "Creating pull request for $branch into main in acme/checkout"
    echo
    echo "https://github.com/acme/checkout/pull/42"
    ;;
  "auth status") echo "github.com: logged in as tape" ;;
  "repo view") echo "acme/checkout" ;;
  *) echo "gh $*: not available in this recording" >&2; exit 1 ;;
esac
`

/** The take's directory, fixed by its name (scripts/record.ts): the stub is beside the project. */
const WORK = "/tmp/ck-rec-trail"

export default {
  name: "trail",
  title: "What a conversation made, and the way back to it",
  cols: 124,
  rows: 34,
  model: "opencode/space-bunny-free",
  startupMs: 16_000,
  sandboxCache: true,
  files: { "src/cart/bundle.ts": BUNDLE },
  setup: [
    "git init -q -b main",
    "git config user.email tape@example.com",
    "git config user.name Tape",
    "git add -A",
    "git commit -qm 'cart: bundles'",
    "git init -q --bare ../origin.git",
    "git remote add origin ../origin.git",
    "git push -q origin main",
    `mkdir -p ../bin && cat > ../bin/gh <<'EOF'\n${GH}EOF\nchmod +x ../bin/gh`,
  ],
  env: {
    PATH: `${WORK}/bin:${process.env.PATH ?? ""}`,
    /** A click on a row opens nothing, rather than a browser on the machine doing the recording. */
    COCKPIT_OPENER: "/usr/bin/true",
  },
  // Trail at the top of the sidebar, and no empty blocks above it
  config: {
    sidebar: ["trail", "status"],
    subagents: { hideWhenEmpty: true },
    shell: { hideWhenEmpty: true },
  },
  steps: [
    {
      send: "COM-1736 https://acme.atlassian.net/browse/COM-1736 — bundles get their discount twice in src/cart/bundle.ts. Fix it, commit on a branch, and open a PR with gh pr create.",
      wait: 2500,
    },
    // the model works: the fix, the commit, the PR — and the record of it, in the sidebar
    { send: KEYS.enter, wait: 150_000 },
    // everything this conversation made, in the dialog
    { send: "\x18f", wait: 4500 },
    { send: KEYS.esc, wait: 1500 },
    // a new conversation, days later, as far as it knows
    { send: "\x18n", wait: 2000 },
    { send: "what did we ship for COM-1736?", wait: 1800 },
    { send: KEYS.enter, wait: 60_000 },
    // /trail here is empty; across every conversation it is not
    { send: "\x18f", wait: 2500 },
    { send: KEYS.tab, wait: 3500 },
    // and back into the conversation that made it
    { send: "g", wait: 5000 },
  ],
} satisfies Tape
