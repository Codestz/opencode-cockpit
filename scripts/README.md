# scripts/

What each script is for, and what runs it. Anything here that nothing runs should go.

## Releasing

| Script | What it does | Run by |
| --- | --- | --- |
| `release.ts` | Prepares a release: bumps every package, promotes the changelog, commits and tags; CI publishes from the tag | `bun run release` |
| `set-version.ts` | Sets every package's version and the pinned versions in READMEs, docs and the landing page | `bun run version:set`, `release.ts` |
| `packages.ts` | The list of packages that publish, in order | `release.ts`, `bootstrap-package.ts`, `trust.ts` |
| `bootstrap-package.ts` | Publishes a new bay's empty `0.0.0` from your machine, so trusted publishing can take over | by hand — CONTRIBUTING, the release workflow's error |
| `trust.ts` | Links a published package to the release workflow as an npm Trusted Publisher | by hand — CONTRIBUTING, the release workflow's error |

## Building and checking

| Script | What it does | Run by |
| --- | --- | --- |
| `build.ts` | Compiles every package to `dist/` | `bun run build`, CI, the release workflow |
| `pack-check.ts` | Packs every package and checks what would publish | `bun run pack:check`, CI, the release workflow |
| `tui-smoke.ts` | Drives a real OpenCode in a PTY through each bay's interface | `bun run smoke:tui` |
| `test-env.ts` | Keeps test runs' logs out of your own `cockpit.log` | `bun test` (preloaded by `bunfig.toml`) |
| `measure-agent.ts` | What every bay's behaviour measurement shares: a real OpenCode, one model turn, what it did | `packages/<bay>/measure/agent.ts` |

## Working on Cockpit

| Script | What it does | Run by |
| --- | --- | --- |
| `dev-install.ts` | Installs this checkout into `~/.cockpit-dev` exactly as a user would get it, to try in a real OpenCode | `bun run dev:install` |
| `clean-daemons.ts` | Stops daemons a test run or a crash left behind | `bun run clean:daemons`, before `test` and `check` |
| `capture.ts` | What OpenCode actually writes to the terminal, escape codes and all — for colour and emphasis bugs no text view shows | `bun run capture` — the Status design skills |

The site has its own scripts in `site/scripts/`: `sync.ts` (the changelog), `engine.ts` (the bays'
renderers for the browser) and `gifs.ts` (the READMEs' GIFs, from the built site).
