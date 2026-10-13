// @ts-check
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

export default defineConfig({
  // GitHub Pages serves the site from /tabherd/.
  site: "https://lmdevv.github.io",
  base: "/tabherd",
  devToolbar: { enabled: false },
  integrations: [
    starlight({
      title: "Tabherd",
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/lmdevv/tabherd" }],
      customCss: ["./src/styles/brand.css"],
      credits: false,
      expressiveCode: { themes: ["github-light", "github-dark"] },
      components: {
        Hero: "./src/components/Hero.astro",
        SiteTitle: "./src/components/SiteTitle.astro",
      },
      sidebar: [
        { label: "Overview", slug: "" },
        { label: "Quick start", slug: "quick-start" },
        { label: "Tools & commands", slug: "tools" },
        { label: "Workflows", slug: "workflows" },
      ],
    }),
  ],
});
