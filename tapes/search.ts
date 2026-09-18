import { KEYS, type Tape } from "../scripts/record.ts"

/** A build log long enough that finding anything in it by eye is hopeless. */
const NOISY = `#!/bin/bash
D=$'\\033[2m'; G=$'\\033[32m'; R=$'\\033[0m'; Y=$'\\033[33m'; RD=$'\\033[31m'
for i in $(seq 1 240); do
  case $((i % 12)) in
    0) printf "%s[%04d]%s %stransform%s src/components/widget-%d.tsx\\n" "$D" "$i" "$R" "$G" "$R" "$i" ;;
    5) printf "%s[%04d]%s resolve node_modules/lodash/lodash.js\\n" "$D" "$i" "$R" ;;
    7) printf "%s[%04d]%s %swarn%s circular import in src/state/store-%d.ts\\n" "$D" "$i" "$R" "$Y" "$R" "$i" ;;
    9) printf "%s[%04d]%s %sERROR%s TS2339 in src/checkout/total-%d.ts\\n" "$D" "$i" "$R" "$RD" "$R" "$i" ;;
    *) printf "%s[%04d]%s bundle chunk-%04d.js %s%d kB%s\\n" "$D" "$i" "$R" "$i" "$D" "$((i * 7 % 400))" "$R" ;;
  esac
  sleep 0.012
done
printf "\\n%sbuild finished%s in 4.21s\\n" "$G" "$R"
sleep 600
`

export default {
  name: "search",
  title: "Finding five lines in a 240-line build log",
  cols: 124,
  rows: 34,
  files: { "build.sh": NOISY },
  warmup: [
    { send: KEYS.ctrlP, wait: 900 },
    { send: "New background shell", wait: 1100 },
    { send: KEYS.enter, wait: 900 },
    { send: "./build.sh", wait: 800 },
    { send: KEYS.enter, wait: 6500 },
    { send: KEYS.tab, wait: 1600 }, // the agent's view: numbered lines
  ],
  steps: [
    { send: "", wait: 2600 }, // opens on a log nobody could read by eye
    { send: KEYS.slash, wait: 1400 },
    { send: "ERROR", wait: 1600 },
    { send: KEYS.enter, wait: 4200 }, // 240 lines down to the four that matter
    { send: KEYS.esc, wait: 2200 },
  ],
} satisfies Tape
