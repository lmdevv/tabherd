// Opt-in integration test: a real extension/native host in a disposable Chromium profile.
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

if (process.platform !== "linux")
  throw new Error("This opt-in Chromium smoke runner currently supports Linux.");
const exec = promisify(execFile);
const root = fileURLToPath(new URL("../../../", import.meta.url));
const entry = join(root, "packages/bridge/dist/index.js");
const extension = join(root, "apps/extension/dist/chrome-mv3");
const extensionId = Array.from(createHash("sha256").update(extension).digest("hex").slice(0, 32))
  .map((c) => String.fromCharCode(97 + parseInt(c, 16)))
  .join("");
const base = await mkdtemp(join(tmpdir(), "tabby-browser-smoke-"));
const profile = join(base, "profile");
const env = {
  ...process.env,
  TABBY_STATE_DIR: join(base, "state"),
  XDG_CONFIG_HOME: join(base, "xdg"),
};
const fixture = createServer((_request, response) => {
  response.setHeader("content-type", "text/html");
  response.end(`<!doctype html><title>Tabby fixture</title><style>body{font:18px sans-serif}#space{height:2000px}</style>
    <h1>Research about local browser control</h1><label>Name <input id="name"></label>
    <button id="save">Save</button><select id="choice"><option value="a">Alpha</option><option value="b">Beta</option></select>
    <a href="/reference">Reference</a><p id="result">Waiting</p><div id="space"></div>
    <script>window.events=[]; nameInput=document.getElementById('name');
    nameInput.addEventListener('input',e=>events.push({type:'input',trusted:e.isTrusted}));
    nameInput.addEventListener('keydown',e=>events.push({type:'key',key:e.key,trusted:e.isTrusted}));
    document.getElementById('save').addEventListener('click',e=>{events.push({type:'click',trusted:e.isTrusted});document.getElementById('result').textContent='Saved '+nameInput.value;});</script>`);
});
fixture.listen(0, "127.0.0.1");
await once(fixture, "listening");
const url = `http://127.0.0.1:${fixture.address().port}/`;
let chrome;
let chromeError;
let logs = "";
let client;
const cli = async (args) => {
  const result = await exec(process.execPath, [entry, ...args], { env });
  return JSON.parse(result.stdout);
};
try {
  for (const directory of [
    join(profile, "NativeMessagingHosts"),
    join(env.XDG_CONFIG_HOME, "chromium/NativeMessagingHosts"),
  ]) {
    await cli([
      "setup",
      "--browser",
      "chromium",
      "--extension-id",
      extensionId,
      "--manifest-dir",
      directory,
    ]);
  }
  chrome = spawn(
    process.env.TABBY_CHROMIUM ?? "chromium",
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${profile}`,
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      "about:blank",
    ],
    { env, stdio: ["ignore", "ignore", "pipe"] },
  );
  chrome.on("error", (error) => {
    chromeError = error;
  });
  chrome.stderr.on("data", (data) => {
    logs = (logs + data).slice(-8000);
  });
  let connections = [];
  for (let attempt = 0; attempt < 80; attempt++) {
    if (chromeError) throw chromeError;
    connections = (await cli(["status"])).connections;
    if (connections.length) break;
    await delay(100);
  }
  assert.equal(connections.length, 1, `Extension failed to connect. ${logs}`);
  assert.equal(connections[0].extensionId, extensionId);
  client = new Client({ name: "tabby-browser-smoke", version: "1" });
  await client.connect(
    new StdioClientTransport({ command: process.execPath, args: [entry, "mcp"], env }),
  );
  const tool = async (name, input = {}) => {
    const response = await client.callTool({ name, arguments: input });
    assert.ok(!response.isError, JSON.stringify(response));
    return response;
  };
  const call = async (method, args) =>
    (await tool("browser_call", { method, args })).structuredContent.result;
  const page = async (tabId, action, input = {}) =>
    (await tool("browser_page", { tabId, action, ...input })).structuredContent.result;
  const caps = (await tool("browser_capabilities")).structuredContent.result;
  assert.ok(caps.methods.includes("tabs.group"));
  const a = await call("tabs.create", [{ url, active: true }]);
  const b = await call("tabs.create", [{ url: `${url}?duplicate`, active: false }]);
  const c = await call("tabs.create", [{ url: `${url}?other`, active: false }]);
  let read;
  for (let i = 0; i < 40; i++) {
    read = await page(a.id, "read");
    if (read.title === "Tabby fixture") break;
    await delay(50);
  }
  assert.match(read.text, /Research about local browser control/);
  assert.ok(read.elements.some((element) => element.selector === "#name"));
  assert.equal((await page(a.id, "read", { maxTextLength: 10 })).text.length, 10);
  await page(a.id, "type", { selector: "#name", text: "Tabby" });
  await page(a.id, "press", { selector: "#name", key: "End" });
  await page(a.id, "click", { selector: "#save" });
  assert.equal(
    await page(a.id, "evaluate", { expression: "document.getElementById('result').textContent" }),
    "Saved Tabby",
  );
  const events = await page(a.id, "evaluate", { expression: "window.events" });
  assert.ok(events.some((event) => event.type === "input" && event.trusted));
  assert.ok(events.some((event) => event.type === "click" && event.trusted));
  assert.ok(events.some((event) => event.type === "key" && event.key === "End" && event.trusted));
  await page(a.id, "type", { selector: "#name", text: "" });
  assert.equal(
    await page(a.id, "evaluate", { expression: "document.getElementById('name').value" }),
    "",
  );
  await page(a.id, "select", { selector: "#choice", value: "b" });
  assert.equal(
    await page(a.id, "evaluate", { expression: "document.getElementById('choice').value" }),
    "b",
  );
  await page(a.id, "scroll", { y: 250 });
  assert.ok(await page(a.id, "evaluate", { expression: "scrollY > 0" }));
  const screenshot = await tool("browser_page", { tabId: a.id, action: "screenshot" });
  assert.equal(screenshot.content[0].type, "image");
  assert.equal(Buffer.from(screenshot.content[0].data, "base64").subarray(1, 4).toString(), "PNG");
  const group = await call("tabs.group", [{ tabIds: [a.id, b.id] }]);
  await call("tabGroups.update", [group, { title: "Research", color: "blue" }]);
  assert.equal((await call("tabGroups.get", [group])).title, "Research");
  const window = await call("windows.create", [{ tabId: c.id, focused: false }]);
  await call("tabs.move", [[b.id], { windowId: window.id, index: -1 }]);
  assert.equal((await call("tabs.get", [b.id])).windowId, window.id);
  const folder = await call("bookmarks.create", [{ title: "Tabby smoke test" }]);
  const bookmark = await call("bookmarks.create", [
    { parentId: folder.id, title: read.title, url: read.url },
  ]);
  assert.equal((await call("bookmarks.get", [bookmark.id]))[0].url, url);
  const batch = (
    await tool("browser_batch", {
      calls: [
        { method: "tabs.update", args: [a.id, { pinned: true }] },
        { method: "tabs.get", args: [a.id] },
      ],
    })
  ).structuredContent.result;
  assert.equal(batch[1].result.pinned, true);
  const stopped = (
    await tool("browser_batch", {
      calls: [
        { method: "tabs.get", args: [99999999] },
        { method: "tabs.remove", args: [a.id] },
      ],
    })
  ).structuredContent.result;
  assert.equal(stopped[0].status, "error");
  assert.equal(stopped[1].status, "skipped");
  assert.equal((await call("tabs.get", [a.id])).id, a.id);
  await call("cookies.set", [{ url, name: "tabby-test", value: "ok" }]);
  assert.equal((await call("cookies.get", [{ url, name: "tabby-test" }])).value, "ok");
  await call("cookies.remove", [{ url, name: "tabby-test" }]);
  await call("bookmarks.removeTree", [folder.id]);
  await call("tabs.remove", [[a.id, b.id, c.id]]);
  assert.ok(!(await call("tabs.query", [{}])).some((tab) => [a.id, b.id, c.id].includes(tab.id)));
  console.log(
    "Real Chromium extension → native host → MCP passed: page read/input/click/select/scroll/evaluate/screenshot, groups, windows, tabs, bookmarks, cookies and batch failure behavior.",
  );
} finally {
  await client?.close();
  if (chrome && chrome.exitCode === null && !chromeError) {
    const exited = once(chrome, "exit");
    chrome.kill("SIGTERM");
    const timer = setTimeout(() => chrome.kill("SIGKILL"), 5000);
    await exited;
    clearTimeout(timer);
  }
  await new Promise((resolve) => fixture.close(resolve));
  await rm(base, { recursive: true, force: true });
}
