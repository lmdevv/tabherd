import { browser } from "wxt/browser";
import { createBridge, RETRY_ALARM } from "../lib/bridge";

export default defineBackground({
  main() {
    const chromium = import.meta.env.BROWSER !== "firefox";
    const bridge = createBridge(browser, chromium);
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (sender.id !== browser.runtime.id) return;
      if (message?.type === "tabherd-status") {
        sendResponse(bridge.getStatus());
      } else if (message?.type === "tabherd-reconnect") {
        bridge.reconnect().then(sendResponse);
        return true;
      }
    });
    browser.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === RETRY_ALARM) void bridge.connect();
    });
    browser.runtime.onInstalled.addListener(() => {
      void bridge.connect();
    });
    browser.runtime.onStartup.addListener(() => {
      void bridge.connect();
    });
    void bridge.connect();

    // Firefox selects its native theme icon variants.
    if (!chromium) return;
    const offscreenUrl = browser.runtime.getURL("/offscreen.html");
    let initializing: Promise<void> | undefined;

    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (
        sender.id !== browser.runtime.id ||
        sender.url !== offscreenUrl ||
        message?.type !== "toolbar-icon-theme" ||
        typeof message.dark !== "boolean"
      ) {
        return;
      }

      const directory = message.dark ? "icon/dark" : "icon";
      browser.action
        .setIcon({
          path: Object.fromEntries(
            [16, 32, 48, 96, 128].map((size) => [size, `${directory}/${size}.png`]),
          ),
        })
        .then(() => sendResponse({ ok: true }))
        .catch((error) => {
          console.error("Failed to update the toolbar icon", error);
          sendResponse({ ok: false });
        });
      return true;
    });

    async function syncIcon() {
      const contexts = await browser.runtime.getContexts({
        contextTypes: ["OFFSCREEN_DOCUMENT"],
        documentUrls: [offscreenUrl],
      });
      if (contexts.length === 0) {
        await browser.offscreen.createDocument({
          url: "offscreen.html",
          reasons: ["MATCH_MEDIA"],
          justification: "Keep the toolbar icon legible when the system color scheme changes.",
        });
      }
      // Also refresh after a service-worker restart when the document already exists.
      await browser.runtime.sendMessage({ type: "toolbar-icon-sync" });
    }

    function initialize() {
      initializing ??= syncIcon()
        .catch((error) => console.error("Failed to initialize the toolbar icon theme", error))
        .finally(() => {
          initializing = undefined;
        });
    }

    browser.runtime.onInstalled.addListener(initialize);
    browser.runtime.onStartup.addListener(initialize);
    initialize();
  },
});
