import { KEYS, type Tape } from "../scripts/record.ts"

const DEV = `#!/bin/bash
G=$'\\033[32m'; C=$'\\033[36m'; D=$'\\033[2m'; B=$'\\033[1m'; R=$'\\033[0m'
sleep 0.3
printf "\\n  %sVITE v5.4.8%s  %sready in 412 ms%s\\n\\n" "$B$G" "$R" "$D" "$R"
printf "  %s➜%s  %sLocal%s:   %shttp://localhost:5173/%s\\n\\n" "$G" "$R" "$B" "$R" "$C" "$R"
i=0
while true; do
  sleep 2; i=$((i+1))
  printf "%s10:14:%02d%s [vite] %shmr update%s src/checkout/total.ts\\n" "$D" "$((i*7%60))" "$R" "$G" "$R"
done
`

const TESTS = `#!/bin/bash
G=$'\\033[32m'; RD=$'\\033[31m'; D=$'\\033[2m'; R=$'\\033[0m'
sleep 0.6
printf " %sRUN%s  v2.1.4 /project\\n\\n" "$D" "$R"
sleep 1.2
printf " %s✓%s src/cart/quantity.test.ts (12 tests) %s412ms%s\\n" "$G" "$R" "$D" "$R"
sleep 1.0
printf " %s✓%s src/cart/coupon.test.ts (8 tests) %s221ms%s\\n" "$G" "$R" "$D" "$R"
sleep 1.2
printf " %s❯%s src/checkout/total.test.ts (6 tests | 1 failed)\\n" "$RD" "$R"
printf "   %s→ expected 42.00 to be 41.50%s\\n" "$RD" "$R"
sleep 0.8
printf "\\n Test Files  %s1 failed%s | %s2 passed%s (3)\\n" "$RD" "$R" "$G" "$R"
printf "      Tests  %s1 failed%s | %s25 passed%s (26)\\n\\n" "$RD" "$R" "$G" "$R"
sleep 600
`

export default {
  name: "tour",
  title: "Background shells, in the interface",
  cols: 124,
  rows: 34,
  files: { "dev-server.sh": DEV, "tests.sh": TESTS },
  warmup: [
    { send: "keep the dev server up while we refactor checkout", wait: 1400 },
    { send: KEYS.ctrlP, wait: 800 },
    { send: "New background shell", wait: 1000 },
    { send: KEYS.enter, wait: 800 },
    { send: "./dev-server.sh", wait: 600 },
    { send: KEYS.enter, wait: 4200 },
    { send: KEYS.esc, wait: 1400 },
  ],
  steps: [
    { send: KEYS.ctrlP, wait: 800 },
    { send: "New background shell", wait: 1000 },
    { send: KEYS.enter, wait: 800 },
    { send: "./tests.sh", wait: 600 },
    { send: KEYS.enter, wait: 6500 }, // a suite fails, in the program's own colours
    { send: "[", wait: 2600 }, // switch to the dev server, no mouse
    { send: "]", wait: 2400 },
    { send: KEYS.esc, wait: 2600 }, // back to the conversation, both still running
  ],
} satisfies Tape
