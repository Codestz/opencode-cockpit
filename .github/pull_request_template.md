## What this changes

<!-- The behaviour change, in a sentence or two. What can someone do now that they could not? -->

## Why

<!-- The problem it solves. If it fixes something that was wrong, say what was wrong and how it
showed up — a symptom someone could have hit is worth more than a description of the code. -->

## How it was verified

<!-- Not "tests pass". What did you actually run, and against what? -->

- [ ] `bun run check` — build, lint, typecheck, tests
- [ ] `bun run pack:check` — every install path (bundle, and each bay alone)
- [ ] `bun run smoke:tui` — the interface draws from a published build
- [ ] Driven in a real OpenCode session

## Known, not fixed

<!-- Anything that does not work, or works only in some setups. Say it here rather than letting
someone find it. A limitation written down is a decision; one left out is a bug report waiting. -->

## Checklist

- [ ] User-visible changes have a line under **Unreleased** in `CHANGELOG.md`
- [ ] New behaviour is documented — package README and the docs site
- [ ] A fix comes with a test that fails without it
- [ ] Nothing new duplicates what OpenCode already shows
