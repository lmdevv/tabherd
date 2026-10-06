// @ts-check
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

export default defineConfig({
  devToolbar: { enabled: false },
  integrations: [
    starlight({
      title: "Tabby",
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
