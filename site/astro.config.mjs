// @ts-check
import starlight from "@astrojs/starlight"
import { defineConfig } from "astro/config"

/**
 * Published to GitHub Pages under a repository path, so every internal link has to go through
 * Astro's `base`. Colours, type and spacing live in src/styles/tokens.css — nothing here.
 */
export default defineConfig({
  site: "https://codestz.github.io",
  base: "/opencode-cockpit",
  trailingSlash: "always",
  integrations: [
    starlight({
      title: "Cockpit",
      description: "Instruments for OpenCode: background terminals today, more bays next.",
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/Codestz/opencode-cockpit" }],
      editLink: { baseUrl: "https://github.com/Codestz/opencode-cockpit/edit/main/site/" },
      lastUpdated: true,
      customCss: ["./src/styles/tokens.css", "./src/styles/starlight.css"],
      components: {
        // The landing page is ours; Starlight owns everything under /docs.
        SiteTitle: "./src/components/DocsTitle.astro",
        Head: "./src/components/DocsHead.astro",
      },
      sidebar: [
        {
          label: "Start",
          items: [
            { label: "What Cockpit is", slug: "start/what-cockpit-is" },
            { label: "Install", slug: "start/install" },
            { label: "Your first session", slug: "start/first-session" },
          ],
        },
        {
          label: "Shell",
          items: [
            { label: "Overview", slug: "shell/overview" },
            { label: "Agent tools", slug: "shell/tools" },
            { label: "Watching health", slug: "shell/watching" },
            { label: "Panel and keys", slug: "shell/interface" },
          ],
        },
        { label: "Configuration", slug: "configuration" },
        {
          label: "Platform",
          items: [
            { label: "Architecture", slug: "platform/architecture" },
            { label: "Capability bays", slug: "platform/bays" },
          ],
        },
        {
          label: "Help",
          items: [
            { label: "Troubleshooting", slug: "help/troubleshooting" },
            { label: "Changelog", slug: "help/changelog" },
          ],
        },
      ],
    }),
  ],
})
