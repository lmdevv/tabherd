const darkMode = window.matchMedia("(prefers-color-scheme: dark)");

function updateIcon() {
  return browser.runtime.sendMessage({
    type: "toolbar-icon-theme",
    dark: darkMode.matches,
  });
}

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "toolbar-icon-sync") return;
  updateIcon().then(sendResponse, (error) => {
    console.error("Failed to sync the toolbar icon theme", error);
    sendResponse({ ok: false });
  });
  return true;
});

darkMode.addEventListener("change", () => {
  void updateIcon().catch((error) => console.error("Failed to sync the toolbar icon theme", error));
});
