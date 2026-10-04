/**
 * Copies the changelog the release script maintains into the docs, so it is kept in one place. The
 * site has no recordings to copy: its windows are drawn by the bays' own renderers (scripts/engine.ts).
 *
 *   bun scripts/sync.ts     (runs before dev and build)
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const root = resolve(import.meta.dir, "..", "..")
const site = resolve(import.meta.dir, "..")

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

console.log("synced the changelog")
