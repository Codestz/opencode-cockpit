# site

The public site and documentation, published to
<https://codestz.github.io/opencode-cockpit/> by `.github/workflows/site.yml`.

```sh
bun install
bun run dev      # sync + astro dev
bun run build    # sync + astro build → dist/
```

Not part of the npm workspace: it is never published, so it keeps its own `package.json` and
lockfile and CI installs it on its own.

## Where things are

| Path | What it holds |
| --- | --- |
| `src/styles/tokens.css` | **Every colour, radius, font and measure.** Change them here and the landing page and docs both follow. |
| `src/styles/starlight.css` | Maps those tokens onto Starlight's variables. Only mappings belong here. |
| `src/data/landing.ts` | Every word on the landing page. Components hold no copy. |
| `src/components/landing/` | One component per section of the landing page. |
| `src/components/Cast.astro` | Plays a recorded session; use it in any docs page. |
| `src/content/docs/` | The documentation, one folder per sidebar group. |
| `scripts/sync.ts` | Copies `tapes/*.cast` and `CHANGELOG.md` in from the repository root. |

Two things are generated and git-ignored, so they never live in two places: `public/casts/` and
`src/content/docs/help/changelog.md`.

## Adding a page

1. Write `src/content/docs/<group>/<page>.md`.
2. Add it to the sidebar in `astro.config.mjs`.
3. Embed a recording with `<Cast name="session" caption="…" />` in an `.mdx` page.

## Adding a recording

Record it in the repository root (`bun run record tapes/<name>.ts`), then reference it by name —
`bun run sync` copies it in.
