import "./style.css";
import { browser } from "wxt/browser";

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <header><img src="/icon/48.png" alt="" width="28" height="28"><span>Tabby</span><span class="local">LOCAL</span></header>
  <main><div class="status"><span id="dot"></span><h1 id="status">Connecting</h1></div>
  <p class="intro">Your browser, connected to your agent.</p>
  <p id="error" role="status" hidden></p>
  <dl><dt>Profile</dt><dd id="profile">—</dd><dt>Extension ID</dt><dd id="extension">—</dd></dl>
  <button id="reconnect" type="button">Reconnect bridge <span aria-hidden="true">↗</span></button>
  <p class="hint">Run <code>tabby setup</code> to install the local bridge.</p></main>
`;
const button = document.querySelector<HTMLButtonElement>("#reconnect")!;
function show(status: {
  connected: boolean;
  error?: string;
  connectionId?: string;
  extensionId?: string;
}) {
  document.querySelector("#status")!.textContent = status.connected
    ? "Bridge connected"
    : "Bridge disconnected";
  document.querySelector("#dot")!.classList.toggle("connected", status.connected);
  const error = document.querySelector<HTMLParagraphElement>("#error")!;
  error.hidden = !status.error;
  error.textContent = status.error || "";
  document.querySelector("#profile")!.textContent = status.connectionId || "—";
  document.querySelector("#extension")!.textContent = status.extensionId || browser.runtime.id;
}
async function update(type = "tabby-status") {
  try {
    show(await browser.runtime.sendMessage({ type }));
  } catch (error) {
    show({ connected: false, error: error instanceof Error ? error.message : String(error) });
  }
}
button.addEventListener("click", async () => {
  button.disabled = true;
  try {
    await update("tabby-reconnect");
  } finally {
    button.disabled = false;
  }
});
void update();
// A failed native host often disconnects just after connectNative returns.
window.setInterval(() => {
  void update();
}, 1000);
