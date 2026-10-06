const darkMode = window.matchMedia("(prefers-color-scheme: dark)");
let appliedTheme: boolean | undefined;
let updating: Promise<void> | undefined;

function updateIcon(force = false): Promise<void> {
  if (updating) return updating;

  // Reading matches reevaluates the query even when hidden pages receive no change event.
  const dark = darkMode.matches;
  if (!force && dark === appliedTheme) return Promise.resolve();

  updating = browser.runtime
    .sendMessage({ type: "toolbar-icon-theme", dark })
    .then((response) => {
      if (!response?.ok) throw new Error("Toolbar icon update was not acknowledged");
      appliedTheme = dark;
    })
    .finally(() => {
      updating = undefined;
    });
  return updating;
}

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "toolbar-icon-sync") return;
  // Reapply after a worker restart even if the system theme is unchanged.
  updateIcon(true).then(
    () => sendResponse({ ok: true }),
    (error) => {
      console.error("Failed to sync the toolbar icon theme", error);
      sendResponse({ ok: false });
    },
  );
  return true;
});

function checkTheme() {
  void updateIcon().catch((error) => console.error("Failed to sync the toolbar icon theme", error));
}

darkMode.addEventListener("change", checkTheme);
// Chromium defers change events in hidden documents. Poll locally without waking
// the service worker unless the theme changed or an update needs to be retried.
window.setInterval(checkTheme, 1000);
