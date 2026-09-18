import type { WatchRule } from "@opencode-cockpit/protocol/shell"

export interface Preset {
  name: string
  /** Matched against the command line to pick a preset automatically. */
  match?: string
  rule: WatchRule
}

/**
 * Watch rules for common tools, as data rather than parsers: `done` marks the end of a run, `fail`
 * and `ok` say how it went. They are deliberately conservative — matching a tool's summary line,
 * not its full output — and a caller can always pass its own rule instead. Adding a tool is a row
 * here, and a wrong guess costs a status, never a crash.
 */
export const PRESETS: Preset[] = [
  // TypeScript and linting
  {
    name: "tsc",
    match: "\\btsc\\b",
    rule: {
      done: "Found \\d+ errors?|Watching for file changes",
      fail: "error TS\\d+",
      ok: "Found 0 errors",
    },
  },
  {
    name: "eslint",
    match: "\\beslint\\b",
    rule: {
      done: "\\d+ problems?|Done in |^\\s*$",
      fail: "\\d+ problems? \\(\\d*[1-9]\\d* error",
      ok: "0 problems",
    },
  },
  {
    name: "biome",
    match: "\\bbiome\\b",
    rule: {
      done: "Checked \\d+ file|Found \\d+ (?:error|warning)",
      fail: "Found \\d+ errors?",
      ok: "No fixes applied|Checked \\d+ files?",
    },
  },
  {
    name: "prettier",
    match: "\\bprettier\\b",
    rule: { done: "\\d+ms$", fail: "\\[error\\]", ok: "\\(unchanged\\)" },
  },
  {
    name: "mypy",
    match: "\\bmypy\\b",
    rule: {
      done: "Success: no issues|Found \\d+ errors?",
      fail: "Found \\d+ errors?",
      ok: "Success: no issues",
    },
  },
  {
    name: "ruff",
    match: "\\bruff\\b",
    rule: { done: "Found \\d+ error|All checks passed", fail: "Found \\d+ errors?", ok: "All checks passed" },
  },

  // Test runners
  {
    name: "vitest",
    match: "\\bvitest\\b",
    rule: {
      done: "Test Files\\s+\\d|Test Files\\s+\\w",
      fail: "Test Files.*failed",
      ok: "Test Files.*passed",
    },
  },
  {
    name: "jest",
    match: "\\bjest\\b",
    rule: { done: "^Tests:\\s", fail: "Tests:.*\\d+ failed", ok: "Tests:.*passed" },
  },
  {
    name: "mocha",
    match: "\\bmocha\\b",
    rule: { done: "\\d+ (?:passing|failing)", fail: "[1-9]\\d* failing", ok: "\\d+ passing" },
  },
  {
    name: "bun-test",
    match: "bun\\s+(?:--\\S+\\s+)*test\\b",
    rule: { done: "Ran \\d+ tests?", fail: "[1-9]\\d* fail", ok: "\\b0 fail" },
  },
  {
    name: "deno-test",
    match: "deno\\s+test\\b",
    rule: { done: "test result:", fail: "FAILED", ok: "test result: ok" },
  },
  {
    name: "pytest",
    match: "\\bpytest\\b",
    rule: {
      done: "=+ .*(?:passed|failed|error|no tests ran).* =+",
      fail: "\\d+ (?:failed|error)",
      ok: "\\d+ passed",
    },
  },
  {
    name: "rspec",
    match: "\\brspec\\b",
    rule: { done: "\\d+ examples?, \\d+ failures?", fail: "[1-9]\\d* failures?", ok: " 0 failures" },
  },
  {
    name: "phpunit",
    match: "phpunit",
    rule: { done: "^OK \\(|FAILURES!|ERRORS!", fail: "FAILURES!|ERRORS!", ok: "^OK \\(" },
  },
  {
    name: "playwright",
    match: "playwright\\s+test",
    rule: { done: "\\d+ (?:passed|failed)", fail: "[1-9]\\d* failed", ok: "\\d+ passed" },
  },
  {
    name: "cypress",
    match: "\\bcypress\\b",
    rule: {
      done: "All specs passed|\\d+ of \\d+ failed",
      fail: "\\d+ of \\d+ failed",
      ok: "All specs passed",
    },
  },

  // Dev servers and bundlers
  {
    name: "vite",
    match: "\\bvite\\b",
    rule: {
      done: "ready in|page reload|hmr update|built in",
      fail: "Internal server error|Rollup failed|error during build",
      ok: "ready in|built in",
    },
  },
  {
    name: "next",
    match: "\\bnext\\s+(?:dev|build|start)",
    rule: {
      done: "Compiled|Ready in|Creating an optimized",
      fail: "Failed to compile|⨯",
      ok: "Compiled successfully|✓ Compiled|Ready in",
    },
  },
  {
    name: "nuxt",
    match: "\\bnuxt\\b",
    rule: { done: "Nuxt .*ready|built in|✔ (?:Client|Server)", fail: "ERROR|✖", ok: "ready in|built in" },
  },
  {
    name: "astro",
    match: "\\bastro\\b",
    rule: {
      done: "watching for file changes|Complete!|ready in",
      fail: "error",
      ok: "Complete!|ready in",
      ignoreCase: true,
    },
  },
  {
    name: "angular",
    match: "\\bng\\s+(?:serve|build|test)",
    rule: {
      done: "Application bundle generation complete|Compiled successfully|Build at",
      fail: "Error:|ERROR",
      ok: "Compiled successfully|generation complete",
    },
  },
  {
    name: "webpack",
    match: "\\b(?:webpack|rspack)\\b",
    rule: {
      done: "compiled|webpack \\d",
      fail: "ERROR in|compiled with \\d+ error",
      ok: "compiled successfully",
    },
  },
  {
    name: "esbuild",
    match: "\\besbuild\\b",
    rule: { done: "build finished|Done in", fail: "✘ \\[ERROR\\]", ok: "build finished" },
  },
  {
    name: "tsup",
    match: "\\btsup\\b",
    rule: { done: "Build success|⚡️ Build", fail: "error", ok: "Build success", ignoreCase: true },
  },
  {
    name: "turbo",
    match: "\\bturbo\\b",
    rule: {
      done: "Tasks:\\s+\\d+ successful",
      fail: "ERROR  run failed|Tasks:.*\\d+ failed",
      ok: "Tasks:\\s+\\d+ successful",
    },
  },
  {
    name: "metro",
    match: "expo\\s+start|react-native\\s+start|\\bmetro\\b",
    rule: { done: "Bundled|BUNDLE", fail: "error:|Failed building", ok: "Bundled", ignoreCase: true },
  },
  {
    name: "storybook",
    match: "storybook",
    rule: { done: "started|built", fail: "ERR!|Error:", ok: "started|built" },
  },

  // Compiled languages and infrastructure
  {
    name: "cargo",
    match: "\\bcargo\\b",
    rule: {
      done: "Finished|error\\[|error:|test result:",
      fail: "^error(?:\\[|:)|test result: FAILED",
      ok: "Finished|test result: ok",
    },
  },
  {
    name: "go",
    match: "\\bgo\\s+(?:build|test|run|vet)",
    rule: { done: "^(?:ok|FAIL|PASS|\\?)\\s", fail: "^FAIL|\\.go:\\d+:", ok: "^ok\\s" },
  },
  {
    name: "dotnet",
    match: "\\bdotnet\\s+(?:build|watch|test|run)",
    rule: {
      done: "Build succeeded|Build FAILED|Passed!|Failed!",
      fail: "Build FAILED|Failed!|error [A-Z]+\\d+",
      ok: "Build succeeded|Passed!",
    },
  },
  {
    name: "gradle",
    match: "\\bgradlew?\\b",
    rule: { done: "BUILD SUCCESSFUL|BUILD FAILED", fail: "BUILD FAILED", ok: "BUILD SUCCESSFUL" },
  },
  {
    name: "maven",
    match: "\\bmvn\\b",
    rule: { done: "BUILD SUCCESS|BUILD FAILURE", fail: "BUILD FAILURE", ok: "BUILD SUCCESS" },
  },
  {
    name: "docker-compose",
    match: "docker[\\s-]compose",
    rule: { fail: "ERROR|exited with code [1-9]", ok: "Started|healthy", idleSeconds: 5 },
  },
  {
    name: "terraform",
    match: "\\bterraform\\b",
    rule: { done: "Apply complete|Plan:|Error:", fail: "Error:", ok: "Apply complete|No changes" },
  },
]

const byName = new Map(PRESETS.map((preset) => [preset.name, preset]))

export function presetByName(name: string): Preset | undefined {
  return byName.get(name)
}

/** First preset whose `match` fits the command, e.g. `npm run dev` → nothing, `tsc --watch` → tsc. */
export function presetForCommand(command: string): Preset | undefined {
  return PRESETS.find((preset) => preset.match && new RegExp(preset.match, "i").test(command))
}
