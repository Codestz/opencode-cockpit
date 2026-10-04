/**
 * Bundles the bays' own renderers for the browser, so the landing page draws each bay with the code
 * that draws it in OpenCode: one module per bay in public/engine/, plus the chunks they share, and a
 * section fetches its bay only when it is about to be seen.
 *
 *   bun scripts/engine.ts     (runs before dev and build, after sync)
 *
 * Bun rather than Vite: Trust reaches for node:path at runtime, which Bun polyfills and Vite does not.
 */
import { rmSync } from "node:fs"
import { join, resolve } from "node:path"

const site = resolve(import.meta.dir, "..")
const packages = resolve(site, "..", "packages")
const out = join(site, "public", "engine")
const bays = ["trail", "subagents", "shell", "review", "status", "trust", "updater"]

rmSync(out, { recursive: true, force: true })
const result = await Bun.build({
  entrypoints: [join(site, "engine", "paint.ts"), ...bays.map((bay) => join(site, "engine", "bays", `${bay}.ts`))],
  root: join(site, "engine"),
  outdir: out,
  target: "browser",
  format: "esm",
  splitting: true,
  minify: true,
  naming: { entry: "[dir]/[name].js", chunk: "chunks/[name]-[hash].js" },
  // Shell's relativeCwd reads $HOME; a visitor has none.
  define: { "process.env.HOME": '""' },
  plugins: [
    {
      name: "workspace-source",
      setup(build) {
        // Review's PNG reader imports node:zlib; the page never decodes a PNG.
        build.onResolve({ filter: /^node:zlib$/ }, () => ({ path: join(site, "engine", "zlib-stub.ts") }))
        // Packages import each other by name; the site reads their source, not a build.
        build.onResolve({ filter: /^@opencode-cockpit\// }, ({ path }) => {
          const [, pkg, sub] = path.match(/^@opencode-cockpit\/([^/]+)\/?(.*)$/) ?? []
          return { path: join(packages, pkg, "src", `${sub || "index"}.ts`) }
        })
      },
    },
  ],
})
if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}
const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`
const entries = result.outputs.filter((o) => o.kind === "entry-point")
const chunks = result.outputs.filter((o) => o.kind === "chunk")
console.log(`engine: ${entries.map((o) => `${o.path.split("/engine/")[1]} ${kb(o.size)}`).join(" · ")} · ${chunks.length} shared chunks ${kb(chunks.reduce((n, o) => n + o.size, 0))}`)
