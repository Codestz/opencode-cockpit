import { KEYS, type Tape } from "../scripts/record.ts"

const DEV_SERVER = `#!/bin/bash
G=$'\\033[32m'; C=$'\\033[36m'; D=$'\\033[2m'; B=$'\\033[1m'; R=$'\\033[0m'; Y=$'\\033[33m'
sleep 0.4
printf "\\n  %sVITE v5.4.8%s  %sready in 412 ms%s\\n\\n" "$B$G" "$R" "$D" "$R"
printf "  %s➜%s  %sLocal%s:   %shttp://localhost:5173/%s\\n" "$G" "$R" "$B" "$R" "$C" "$R"
printf "  %s➜%s  %sNetwork%s: use --host to expose\\n\\n" "$G" "$R" "$D" "$R"
sleep 1.6
printf "%s10:14:02%s [vite] %spage reload%s src/app.tsx\\n" "$D" "$R" "$C" "$R"
sleep 1.6
printf "%s10:14:09%s [vite] %shmr update%s src/routes/checkout.tsx\\n" "$D" "$R" "$G" "$R"
sleep 1.6
printf "%s10:14:15%s [vite] %swarning%s: chunk larger than 500 kB\\n" "$D" "$R" "$Y" "$R"
while true; do sleep 2; printf "%s10:14:2%s%s [vite] %shmr update%s src/components/cart.tsx\\n" "$D" "$((RANDOM%9))" "$R" "$G" "$R"; done
`

export default {
  name: "dock",
  title: "A dev server running in the shells panel",
  rows: 24,
  files: { "dev-server.sh": DEV_SERVER },
  steps: [
    { send: KEYS.ctrlP, wait: 900 },
    { send: "New background shell", wait: 1200 },
    { send: KEYS.enter, wait: 1000 },
    { send: "./dev-server.sh", wait: 900 },
    { send: KEYS.enter, wait: 9000 },
    { send: KEYS.esc, wait: 1500 },
  ],
} satisfies Tape
