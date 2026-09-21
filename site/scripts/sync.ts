/**
 * Copies the two things the site needs from the repository root, so neither is kept in two places:
 * the recorded sessions (tapes/*.cast) and the changelog the release script maintains.
 *
 *   bun scripts/sync.ts     (runs before dev and build)
 */
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const root = resolve(import.meta.dir, "..", "..")
const site = resolve(import.meta.dir, "..")

const casts = join(site, "public", "casts")
mkdirSync(casts, { recursive: true })
const tapes = readdirSync(join(root, "tapes")).filter((f) => f.endsWith(".cast"))
/**
 * Published as `.cast.json`, not `.cast`.
 *
 * A cast is JSON, but nothing serving it knows that from the extension: GitHub Pages calls an unknown
 * one `application/octet-stream` and does not compress those. The recordings are 80% escape sequences
 * and compress about 15:1 — the review tape is 750KB served raw and 50KB served as JSON. Same bytes,
 * same player, one suffix.
 */
for (const file of tapes) copyFileSync(join(root, "tapes", file), join(casts, `${file}.json`))

// Screenshots live in media/ alongside the recordings, and are served from the site's own origin
// so a page renders the same locally as it does once deployed.
const shots = join(site, "public", "media")
mkdirSync(shots, { recursive: true })
const images = readdirSync(join(root, "media")).filter((f) => f.endsWith(".png"))
for (const file of images) copyFileSync(join(root, "media", file), join(shots, file))

// The changelog is a docs page, but the release script owns the file: import it with a title.
const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8")
  .replace(/^# Changelog\n+/, "")
  .replace(/^All notable changes[\s\S]*?\[Semantic Versioning\]\(https:\/\/semver\.org\/\)\.\n+/, "")
const page = `---
title: Changelog
description: Every released version of Cockpit, newest first.
editUrl: false
---

Maintained in [CHANGELOG.md](https://github.com/Codestz/opencode-cockpit/blob/main/CHANGELOG.md) and
published with each release.

${changelog}`
mkdirSync(join(site, "src", "content", "docs", "help"), { recursive: true })
writeFileSync(join(site, "src", "content", "docs", "help", "changelog.md"), page)

console.log(`synced ${tapes.length} casts, ${images.length} images and the changelog`)
