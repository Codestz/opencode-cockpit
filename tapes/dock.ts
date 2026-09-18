import { KEYS, type Tape } from "../scripts/record.ts"

/** A dev server that keeps printing, so the panel has something live to show. */
const DEV = `#!/bin/bash
G=$'\\033[32m'; C=$'\\033[36m'; D=$'\\033[2m'; B=$'\\033[1m'; R=$'\\033[0m'; Y=$'\\033[33m'
printf "\\n  %sVITE v5.4.8%s  %sready in 412 ms%s\\n\\n" "$B$G" "$R" "$D" "$R"
printf "  %s➜%s  %sLocal%s:   %shttp://localhost:5173/%s\\n" "$G" "$R" "$B" "$R" "$C" "$R"
printf "  %s➜%s  %sNetwork%s: use --host to expose\\n\\n" "$G" "$R" "$D" "$R"
i=0
while true; do
  sleep 1.6; i=$((i+1))
  case $((i % 4)) in
    0) printf "%s10:14:%02d%s [vite] %spage reload%s src/app.tsx\\n" "$D" "$((i*7%60))" "$R" "$C" "$R" ;;
    2) printf "%s10:14:%02d%s [vite] %swarning%s chunk larger than 500 kB\\n" "$D" "$((i*7%60))" "$R" "$Y" "$R" ;;
    *) printf "%s10:14:%02d%s [vite] %shmr update%s src/checkout/total.ts\\n" "$D" "$((i*7%60))" "$R" "$G" "$R" ;;
  esac
done
`

export default {
  name: "dock",
  title: "A dev server running under the conversation",
  cols: 124,
  rows: 34,
  files: { "dev-server.sh": DEV },
  // Starting the shell is setup, not demo: do it before the recording begins.
  warmup: [
    // a prompt sitting in the composer, so the frame reads as a working session
    { send: "keep the dev server up while we refactor checkout", wait: 1200 },
    { send: KEYS.ctrlP, wait: 900 },
    { send: "New background shell", wait: 1100 },
    { send: KEYS.enter, wait: 900 },
    { send: "./dev-server.sh", wait: 700 },
    { send: KEYS.enter, wait: 5200 },
    { send: KEYS.esc, wait: 1600 }, // leave the console: the docked panel is the view people live in
  ],
  steps: [
    { send: "", wait: 6500 }, // the whole interface, with the server running underneath it
    { send: KEYS.ctrlP, wait: 900 },
    { send: "Open shell console", wait: 1200 },
    { send: KEYS.enter, wait: 3600 }, // and the console when you want the detail
    { send: KEYS.tab, wait: 3400 },
    { send: KEYS.esc, wait: 2600 },
  ],
} satisfies Tape
