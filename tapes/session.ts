import { KEYS, type Tape } from "../scripts/record.ts"

/**
 * The money shot: a real conversation. The agent is asked for something that cannot be done in a
 * blocking tool call, uses shell_start, and the panel fills while the answer comes back.
 *
 * This tape spends a model turn, so it is not part of the release loop — record it by hand.
 */
const DEV = `#!/bin/bash
G=$'\\033[32m'; C=$'\\033[36m'; D=$'\\033[2m'; B=$'\\033[1m'; R=$'\\033[0m'; Y=$'\\033[33m'
printf "\\n  %sVITE v5.4.8%s  %sready in 412 ms%s\\n\\n" "$B$G" "$R" "$D" "$R"
printf "  %s➜%s  %sLocal%s:   %shttp://localhost:5173/%s\\n\\n" "$G" "$R" "$B" "$R" "$C" "$R"
i=0
while true; do
  sleep 2; i=$((i+1))
  printf "%s10:14:%02d%s [vite] %shmr update%s src/checkout/total.ts\\n" "$D" "$((i*7%60))" "$R" "$G" "$R"
done
`

export default {
  name: "session",
  title: "Asking for a dev server, and getting on with the work",
  cols: 124,
  rows: 34,
  files: { "dev-server.sh": DEV },
  // the panel is open from the start: the point is seeing it fill while the answer arrives
  config: { ui: { dockOpen: true } },
  steps: [
    {
      send: "start ./dev-server.sh in the background, wait until it's listening, then tell me the url",
      wait: 1600,
    },
    { send: KEYS.enter, wait: 34_000 }, // the model works; the player compresses the thinking
    // and now the half nobody else shows: the interface. Through the palette, because a slash
    // typed into the composer is a message, not a command.
    { send: "", wait: 4200 }, // the panel has been filling underneath all along
    { send: KEYS.console, wait: 4200 }, // the console: full output, keys, details
    { send: KEYS.tab, wait: 3400 }, // the agent's view — numbered lines
    { send: KEYS.esc, wait: 3400 }, // back to the conversation, panel still there
  ],
} satisfies Tape
