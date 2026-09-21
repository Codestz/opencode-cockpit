import { KEYS, type Tape } from "../scripts/record.ts"

/**
 * Two plugins behind, one of them the way people actually get stuck: `@latest` in the config, an
 * older release in the cache, and nothing anywhere that says so.
 *
 *   bun scripts/record.ts tapes/updater.ts
 *   bun scripts/tighten.ts tapes/updater.cast 1.6     # cap the silences, including the npm install
 *
 * Both plugins are real and published: small, inspected before use, and inert without their own
 * configuration — `opencode-command-hooks` runs nothing unless a project defines hooks. They are
 * installed by OpenCode's own `opencode plugin`, and the frozen one is frozen exactly the way it
 * happens to people — an old release left in `name@latest/`. The session's plugin cache is its own
 * (`sandboxCache`), so none of this touches the machine doing the recording. The update at the end
 * is live: `opencode plugin -f` really runs, and the result is really read back from disk.
 */
const tape: Tape = {
  name: "updater",
  title: "Updater — a frozen @latest, found and fixed",
  cols: 120,
  rows: 34,
  sandboxCache: true,
  setup: [
    "opencode plugin opencode-command-hooks@0.6.1 --global </dev/null >/dev/null",
    "opencode plugin opencode-subagent-statusline@latest --global </dev/null >/dev/null",
    // What `@latest` looks like months later: the directory is named for the tag and never moves.
    'cd "$XDG_CACHE_HOME/opencode/packages/opencode-subagent-statusline@latest" && npm install opencode-subagent-statusline@1.2.3 --save-exact --silent',
  ],
  steps: [
    { wait: 800 },
    { send: "/plugins-update", wait: 900 },
    { send: KEYS.enter, wait: 4500 }, // the registry answers
    { send: KEYS.down, wait: 900 },
    { send: KEYS.up, wait: 900 },
    { send: KEYS.enter, wait: 3500 }, // the review: every file, nothing written yet
    { send: KEYS.enter, wait: 25_000 }, // opencode plugin -f, twice, from npm
    { wait: 3000 },
  ],
}

export default tape
