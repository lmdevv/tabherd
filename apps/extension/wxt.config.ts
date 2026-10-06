import { defineConfig } from "wxt";

// See https://wxt.dev/api/config.html
export default defineConfig({
  outDir: "dist",
  manifest: ({ browser, manifestVersion }) => {
    const toolbarIcon = {
      default_icon: {
        16: "icon/16.png",
        32: "icon/32.png",
        48: "icon/48.png",
        96: "icon/96.png",
        128: "icon/128.png",
      },
      ...(browser === "firefox" && {
        theme_icons: [16, 32, 48, 96, 128].map((size) => ({
          size,
          // Firefox names these for the foreground color, not the theme.
          light: `icon/dark/${size}.png`,
          dark: `icon/${size}.png`,
        })),
      }),
      ...(browser === "safari" && {
        icon_variants: ["light", "dark"].map((scheme) => ({
          ...Object.fromEntries(
            [16, 32, 48, 96, 128].map((size) => [
              size,
              `icon/${scheme === "dark" ? "dark/" : ""}${size}.png`,
            ]),
          ),
          color_schemes: [scheme],
        })),
      }),
    };

    return {
      ...(manifestVersion === 3 ? { action: toolbarIcon } : { browser_action: toolbarIcon }),
      ...(browser !== "firefox" &&
        browser !== "safari" && {
          minimum_chrome_version: "116",
          permissions: ["offscreen"],
        }),
    };
  },
  webExt: {
    disabled: true,
  },
});
