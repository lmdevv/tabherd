import "./style.css";
import { browser } from "wxt/browser";
import {
  ACCESS_LABELS,
  ACCESS_MODES,
  ACCESS_STORAGE_KEY,
  isAccessMode,
  type AccessMode,
} from "../../lib/policy";
import type { Activity } from "../../lib/engine";

const ACCESS_HINTS: Record<AccessMode, string> = {
  full: "Agents can use every browser API and page action.",
  standard:
    "Blocks cookies, running JavaScript in pages, clearing browsing data, and deleting history or downloaded files.",
  "read-only": "Agents can inspect tabs, bookmarks, history, and pages, but not change anything.",
};
const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <header><img src="/icon/48.png" alt="" width="28" height="28"><span>Tabherd</span><span class="local">LOCAL</span></header>
  <main><div class="status"><span id="dot"></span><h1 id="status">Connecting</h1></div>
  <p class="intro">Your browser, connected to your agent.</p>
  <p id="error" role="status" hidden></p>
  <label class="field" for="access">Agent access</label>
  <select id="access">${ACCESS_MODES.map((mode) => `<option value="${mode}">${ACCESS_LABELS[mode]}</option>`).join("")}</select>
  <p id="access-hint" class="hint"></p>
  <dl><dt>Profile</dt><dd id="profile">—</dd><dt>Bridge</dt><dd id="bridge">—</dd><dt>Extension ID</dt><dd id="extension">—</dd></dl>
  <section aria-labelledby="activity-title"><h2 id="activity-title">Recent activity</h2><ol id="activity"></ol></section>
  <button id="reconnect" type="button">Reconnect bridge <span aria-hidden="true">↗</span></button>
  <p class="hint">Not connecting? Run <code>tabherd doctor</code>.</p></main>
`;
const button = document.querySelector<HTMLButtonElement>("#reconnect")!;
const access = document.querySelector<HTMLSelectElement>("#access")!;
const hint = document.querySelector<HTMLParagraphElement>("#access-hint")!;
function showAccess(mode: AccessMode) {
  access.value = mode;
  hint.textContent = ACCESS_HINTS[mode];
}
function show(status: {
  connected: boolean;
  error?: string;
  connectionId?: string;
  extensionId?: string;
  hostVersion?: string;
}) {
  document.querySelector("#status")!.textContent = status.connected
    ? "Bridge connected"
    : "Bridge disconnected";
  document.querySelector("#dot")!.classList.toggle("connected", status.connected);
  const error = document.querySelector<HTMLParagraphElement>("#error")!;
  error.hidden = !status.error;
  error.textContent = status.error || "";
  document.querySelector("#profile")!.textContent = status.connectionId || "—";
  document.querySelector("#bridge")!.textContent = status.hostVersion
    ? `tabherd ${status.hostVersion}`
    : "—";
  document.querySelector("#extension")!.textContent = status.extensionId || browser.runtime.id;
}
const ago = (time: number) => {
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000));
  return seconds < 60
    ? `${seconds}s`
    : seconds < 3600
      ? `${Math.floor(seconds / 60)}m`
      : `${Math.floor(seconds / 3600)}h`;
};
function showActivity(items: Activity[]) {
  const list = document.querySelector<HTMLOListElement>("#activity")!;
  list.replaceChildren(
    ...(items.length
      ? items.slice(0, 8).map((item) => {
          const row = document.createElement("li");
          row.className = item.ok ? "ok" : "failed";
          row.title = item.error ?? "";
          const operation = document.createElement("span");
          operation.textContent = item.operation;
          const time = document.createElement("time");
          time.textContent = ago(item.time);
          row.append(operation, time);
          return row;
        })
      : [
          Object.assign(document.createElement("li"), {
            className: "empty",
            textContent: "No agent activity yet.",
          }),
        ]),
  );
}
async function update(type = "tabherd-status") {
  try {
    show(await browser.runtime.sendMessage({ type }));
  } catch (error) {
    show({ connected: false, error: error instanceof Error ? error.message : String(error) });
    return;
  }
  showActivity(
    (await browser.runtime.sendMessage({ type: "tabherd-activity" }).catch(() => [])) ?? [],
  );
}
// The extension stores the mode; agents have no API to change it.
const stored = await browser.storage.local.get(ACCESS_STORAGE_KEY);
const saved = stored[ACCESS_STORAGE_KEY];
showAccess(isAccessMode(saved) ? saved : "full");
access.addEventListener("change", async () => {
  const mode = access.value as AccessMode;
  await browser.storage.local.set({ [ACCESS_STORAGE_KEY]: mode });
  showAccess(mode);
});
button.addEventListener("click", async () => {
  button.disabled = true;
  try {
    await update("tabherd-reconnect");
  } finally {
    button.disabled = false;
  }
});
void update();
// A failed native host often disconnects just after connectNative returns.
window.setInterval(() => {
  void update();
}, 1000);
