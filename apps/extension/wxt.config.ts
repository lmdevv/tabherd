import { defineConfig } from "wxt";

export default defineConfig({
  outDir: "dist",
  zip: { artifactTemplate: "tabherd-{{version}}-{{browser}}.zip" },
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
    };

    return {
      name: "Tabherd",
      description: "Your browser, connected to your local agent.",
      permissions: [
        "nativeMessaging",
        "tabs",
        "tabGroups",
        "bookmarks",
        "history",
        "sessions",
        "downloads",
        "cookies",
        "browsingData",
        "storage",
        "scripting",
        "alarms",
        "search",
        ...(browser === "firefox" ? [] : ["debugger", "offscreen"]),
        ...(manifestVersion === 2 ? ["<all_urls>"] : []),
      ],
      ...(manifestVersion === 3 && { host_permissions: ["<all_urls>"] }),
      ...(browser === "firefox" && {
        browser_specific_settings: {
          gecko: { id: "tabherd@local", data_collection_permissions: { required: ["none"] } },
        },
      }),
      ...(manifestVersion === 3 ? { action: toolbarIcon } : { browser_action: toolbarIcon }),
      ...(browser !== "firefox" && {
        minimum_chrome_version: "116",
      }),
    };
  },
  webExt: {
    disabled: true,
  },
});
