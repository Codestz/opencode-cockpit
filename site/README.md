# site

The public site and documentation, published to
<https://cockpit.codestz.dev/> by `.github/workflows/site.yml`.

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
| `src/components/Live.astro` | A live window — a bay drawn by its own renderer — in any docs page. |
| `src/scripts/live.ts` | The players those windows play, shared by the landing page and the docs. |
| `engine/` | The bays' renderers the windows draw with, one module per bay. |
| `scripts/engine.ts` | Bundles `engine/` for the browser into `public/engine/`, reading the packages' source. |
| `scripts/gifs.ts` | Writes the READMEs' GIFs in `media/` from the built site (`bun run gifs`). |
| `src/content/docs/` | The documentation, one folder per sidebar group. |
| `scripts/sync.ts` | Copies `CHANGELOG.md` in from the repository root. |

Two things are generated and git-ignored, so they never live in two places: `public/engine/` and
`src/content/docs/help/changelog.md`.

## Adding a page

1. Write `src/content/docs/<group>/<page>.md`.
2. Add it to the sidebar in `astro.config.mjs`.
3. Show a bay with `<Live scene="trust" caption="…" />` in an `.mdx` page — any player in
   `src/scripts/live.ts`.

## Adding a scene

A scene is a player in `src/scripts/live.ts`: given the seconds since it came into view, it returns
rows to draw — rows a bay's own renderer made, through a module in `engine/bays/`. If it needs
something a bay does not export yet, add it to that bay's engine module (or, better, to the bay as a
pure function it can share). There are no recordings: a window cannot drift from what ships, because
it is what ships.
