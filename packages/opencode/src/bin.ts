#!/usr/bin/env node
/**
 * `npx opencode-cockpit@latest update` — the rescue for anyone whose installed copy is too old to
 * update itself, under the name they already installed.
 *
 * Node, not Bun, and nothing from the bays is loaded but Status's settings words, guarded: `npx` may
 * run where there is no `bun`, and a bin that cannot start is the one failure this exists to get
 * people out of.
 */

const HELP = `Usage: npx opencode-cockpit@latest <command>

  update    show every OpenCode plugin you have installed and update the ones that are behind
            (--only <name>, --dry-run, --yes; see \`update --help\`)
  doctor    check OpenCode, its config, Cockpit's logs and the daemon, and say how to fix what is
            wrong (--json for an issue)
`

const [command, ...rest] = process.argv.slice(2)

if (command === "update" || command === "doctor") {
  /**
   * The one exception: doctor lists what Status's line warns about (an unknown preset, an override
   * matching no segment), and only Status knows those words. Its config module is plain Node; one
   * that will not load costs those lines, never doctor.
   */
  if (command === "doctor") {
    try {
      const [{ offerSettingsCheck }, { statusNotices }] = await Promise.all([
        import("@opencode-cockpit/client/checks"),
        import("@opencode-cockpit/status/config"),
      ])
      offerSettingsCheck("status", statusNotices)
    } catch {
      // doctor runs without them
    }
  }
  const { main } = await import("@opencode-cockpit/updater/cli")
  process.exitCode = await main(command === "doctor" ? [command, ...rest] : rest)
} else {
  process.stdout.write(HELP)
  process.exitCode = command === undefined || command === "--help" || command === "-h" ? 0 : 2
}

export {}
