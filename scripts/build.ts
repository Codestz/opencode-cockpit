/**
 * Compiles every package's `src/` to plain JavaScript in `dist/`, which is what gets published.
 *
 * Every package builds through this one script on purpose: publishing compiled output from a
 * single pipeline keeps "works from a checkout, broken once installed" bugs from coming back.
 *
 * Why this exists: OpenCode compiles plugin JSX with OpenTUI's Solid transform, which produces
 * Solid's fine-grained reactive code, but that Bun plugin skips every file under `node_modules`
 * (`/^(?!.*[/\\]node_modules[/\\]).*\.[cm]?[jt]sx?$/`). A published plugin always lives there, so
 * shipping `.tsx` gives components that render once and never update. Compiling here with the
 * same Babel setup (`babel-preset-solid`, `generate: "universal"`) makes the published code
 * behave exactly like the working local checkout.
 *
 * Bare `solid-js` / `@opentui/*` imports are left untouched on purpose: OpenCode's other Bun
 * plugin rewrites them (inside node_modules too) to the host's own module instances, which is
 * what keeps reactivity and the keymap shared with the host.
 */

import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { transformAsync } from "@babel/core"
// @ts-expect-error untyped babel preset
import typescriptPreset from "@babel/preset-typescript"
// @ts-expect-error untyped babel preset
import solidPreset from "babel-preset-solid"

const root = join(import.meta.dir, "..")
const packages = readdirSync(join(root, "packages")).sort()

/** Emitted JS must import emitted JS: `./store.ts` → `./store.js`. */
function rewriteRelativeExtensions(code: string): string {
  return code.replace(/(\bfrom\s*|\bimport\s*\(\s*)(["'])(\.[^"']*?)\.tsx?\2/g, "$1$2$3.js$2")
}

for (const pkg of packages) {
  const srcDir = join(root, "packages", pkg, "src")
  const outDir = join(root, "packages", pkg, "dist")
  if (!existsSync(srcDir)) continue
  rmSync(outDir, { recursive: true, force: true })

  const files = [...new Bun.Glob("**/*.{ts,tsx}").scanSync(srcDir)].sort()
  if (files.length === 0) throw new Error(`no sources found in ${srcDir}`)

  for (const file of files) {
    const filename = join(srcDir, file)
    const code = await Bun.file(filename).text()
    const result = await transformAsync(code, {
      filename,
      configFile: false,
      babelrc: false,
      presets: [
        // JSX needs Solid's transform; every other file only needs its types stripped.
        ...(file.endsWith("x")
          ? [[solidPreset, { moduleName: "@opentui/solid", generate: "universal" }]]
          : []),
        [typescriptPreset],
      ],
    })
    const out = join(outDir, file.replace(/\.tsx?$/, ".js"))
    mkdirSync(dirname(out), { recursive: true })
    await Bun.write(out, rewriteRelativeExtensions(result?.code ?? code))
  }
  console.log(`${pkg}: ${files.length} file${files.length === 1 ? "" : "s"} → packages/${pkg}/dist`)
}
