// Opt-in integration test: a real extension/native host in a disposable Chromium profile.
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
// The manifest key pins this ID wherever the extension is loaded from.
const extensionId = "hepgdbeccdmbongocnnamapillglcbgk";
const base = await mkdtemp(join(tmpdir(), "tabherd-browser-smoke-"));
const profile = join(base, "profile");
const env = {
  ...process.env,
  TABHERD_STATE_DIR: join(base, "state"),
  XDG_CONFIG_HOME: join(base, "xdg"),
};
const fixture = createServer((_request, response) => {
  response.setHeader("content-type", "text/html");
  response.end(`<!doctype html><title>Tabherd fixture</title><style>body{font:18px sans-serif}#space{height:2000px}</style>
    <h1>Research about local browser control</h1><label>Name <input id="name"></label>
    <button id="save">Save</button><select id="choice"><option value="a">Alpha</option><option value="b">Beta</option></select>
    <a href="/reference">Reference</a><p id="result">Waiting</p>
    <p id="hover" style="padding:8px">Hover me</p><input id="file" type="file">
    <div id="handle" style="width:40px;height:40px;background:#c33;position:relative"></div>
    <div id="drop" style="width:80px;height:80px;margin-left:300px;background:#3c3"></div>
    <div id="card" draggable="true" style="width:60px;height:30px;background:#33c">Card</div>
    <div id="bin" style="width:120px;height:60px;margin-left:300px;background:#ccc">Bin</div>
    <p id="ghost" style="visibility:hidden">Ghost</p>
    <div id="space"></div>
    <script>window.events=[]; nameInput=document.getElementById('name');
    nameInput.addEventListener('input',e=>events.push({type:'input',trusted:e.isTrusted}));
    nameInput.addEventListener('keydown',e=>events.push({type:'key',key:e.key,trusted:e.isTrusted}));
    document.getElementById('save').addEventListener('click',e=>{events.push({type:'click',trusted:e.isTrusted});document.getElementById('result').textContent='Saved '+nameInput.value;});
    document.getElementById('hover').addEventListener('mouseover',e=>{e.target.textContent='Hovered '+e.isTrusted;});
    document.getElementById('file').addEventListener('change',e=>{window.uploaded=[...e.target.files].map(f=>f.name);});
    const handle=document.getElementById('handle');let dragging=false;
    handle.addEventListener('mousedown',()=>{dragging=true;});
    addEventListener('mouseup',e=>{if(!dragging)return;dragging=false;const r=document.getElementById('drop').getBoundingClientRect();
      window.dropped=e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom;});
    const card=document.getElementById('card'),bin=document.getElementById('bin');
    card.addEventListener('dragstart',e=>e.dataTransfer.setData('text/plain','card-1'));
    bin.addEventListener('dragover',e=>e.preventDefault());
    bin.addEventListener('drop',e=>{e.preventDefault();window.html5Dropped=e.dataTransfer.getData('text/plain');});
    setTimeout(()=>{const late=document.createElement('p');late.id='late';late.textContent='Loaded later';document.body.prepend(late);},700);</script>`);
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
    await cli(["setup", "--browser", "chromium", "--manifest-dir", directory]);
  }
  chrome = spawn(
    process.env.TABHERD_CHROMIUM ?? "chromium",
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
  const report = await cli(["doctor"]).catch((error) => JSON.parse(error.stdout));
  assert.ok(report.ok, JSON.stringify(report));
  client = new Client({ name: "tabherd-browser-smoke", version: "1" });
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
  const pageError = async (tabId, action, input = {}) => {
    const response = await client.callTool({
      name: "browser_page",
      arguments: { tabId, action, ...input },
    });
    assert.ok(response.isError, JSON.stringify(response));
    return response.content[0].text;
  };
  const caps = (await tool("browser_capabilities")).structuredContent.result;
  assert.ok(caps.methods.includes("tabs.group"));
  const events = async (input) => (await tool("browser_events", input)).structuredContent.result;
  const { cursor } = await events({});
  const a = await call("tabs.create", [{ url, active: true }]);
  const b = await call("tabs.create", [{ url: `${url}?duplicate`, active: false }]);
  const c = await call("tabs.create", [{ url: `${url}?other`, active: false }]);
  // Long-poll for the load event instead of sleeping.
  let loaded;
  for (let since = cursor; !loaded;) {
    const batch = await events({ cursor: since, types: ["tab."], timeoutMs: 10000 });
    assert.ok(batch.events.length, "timed out waiting for tab events");
    loaded = batch.events.find(
      (event) =>
        event.type === "tab.updated" && event.tabId === a.id && event.changes.status === "complete",
    );
    since = batch.cursor;
  }
  const created = await events({ cursor, types: ["tab.created"] });
  assert.ok(created.events.some((event) => event.tab.id === a.id));
  const read = await page(a.id, "read");
  assert.equal(read.title, "Tabherd fixture");
  assert.match(read.text, /Research about local browser control/);
  assert.ok(read.elements.some((element) => element.selector === "#name"));
  assert.equal((await page(a.id, "read", { maxTextLength: 10 })).text.length, 10);
  const small = await page(a.id, "read", { maxElements: 1 });
  assert.equal(small.elements.length, 1);
  assert.ok(small.elementsTruncated);
  assert.ok((await page(a.id, "wait", { selector: "#late", timeoutMs: 5000 })).ok);
  await page(a.id, "wait", { text: "Loaded later" });
  await page(a.id, "wait", { selector: "#missing", gone: true });
  // visibility: hidden elements are not visible, so they count as gone.
  await page(a.id, "wait", { selector: "#ghost", gone: true, timeoutMs: 1000 });
  assert.match(
    await pageError(a.id, "wait", { selector: "#never", timeoutMs: 300 }),
    /Timed out after 300 ms waiting for selector #never/,
  );
  await page(a.id, "hover", { selector: "#hover" });
  assert.equal(
    await page(a.id, "evaluate", { expression: "document.getElementById('hover').textContent" }),
    "Hovered true",
  );
  await page(a.id, "drag", { selector: "#handle", toSelector: "#drop" });
  assert.equal(await page(a.id, "evaluate", { expression: "window.dropped" }), true);
  const html5 = await page(a.id, "drag", { selector: "#card", toSelector: "#bin" });
  assert.equal(html5.html5, true);
  assert.equal(await page(a.id, "evaluate", { expression: "window.html5Dropped" }), "card-1");
  const started = Date.now();
  assert.match(
    await pageError(a.id, "wait", { selector: "div[", timeoutMs: 10000 }),
    /not a valid selector/,
  );
  assert.ok(Date.now() - started < 3000, "invalid selectors fail fast");
  assert.match(
    await pageError(a.id, "click", { selector: "#nope" }),
    /No element matches selector: #nope/,
  );
  const upload = join(base, "notes.txt");
  await writeFile(upload, "uploaded by tabherd");
  assert.equal((await page(a.id, "upload", { selector: "#file", files: [upload] })).files, 1);
  assert.deepEqual(await page(a.id, "evaluate", { expression: "window.uploaded" }), ["notes.txt"]);
  assert.match(
    await pageError(a.id, "upload", { selector: "#file", files: [join(base, "absent.txt")] }),
    /Upload file not found/,
  );
  assert.match(
    await pageError(a.id, "upload", { selector: "#name", files: [upload] }),
    /input type=file/,
  );
  await page(a.id, "type", { selector: "#name", text: "Tabherd" });
  await page(a.id, "press", { selector: "#name", key: "End" });
  await page(a.id, "click", { selector: "#save" });
  assert.equal(
    await page(a.id, "evaluate", { expression: "document.getElementById('result').textContent" }),
    "Saved Tabherd",
  );
  const dom = await page(a.id, "evaluate", { expression: "window.events" });
  assert.ok(dom.some((event) => event.type === "input" && event.trusted));
  assert.ok(dom.some((event) => event.type === "click" && event.trusted));
  assert.ok(dom.some((event) => event.type === "key" && event.key === "End" && event.trusted));
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
  await call("tabs.update", [a.id, { url: `${url}?reloaded` }]);
  await page(a.id, "wait", { url: "?reloaded", timeoutMs: 10000 });
  assert.equal((await page(a.id, "read")).url, `${url}?reloaded`);
  const group = await call("tabs.group", [{ tabIds: [a.id, b.id] }]);
  await call("tabGroups.update", [group, { title: "Research", color: "blue" }]);
  assert.equal((await call("tabGroups.get", [group])).title, "Research");
  const window = await call("windows.create", [{ tabId: c.id, focused: false }]);
  await call("tabs.move", [[b.id], { windowId: window.id, index: -1 }]);
  assert.equal((await call("tabs.get", [b.id])).windowId, window.id);
  const folder = await call("bookmarks.create", [{ title: "Tabherd smoke test" }]);
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
  await call("cookies.set", [{ url, name: "tabherd-test", value: "ok" }]);
  assert.equal((await call("cookies.get", [{ url, name: "tabherd-test" }])).value, "ok");
  await call("cookies.remove", [{ url, name: "tabherd-test" }]);
  await call("bookmarks.removeTree", [folder.id]);
  await call("tabs.remove", [[a.id, b.id, c.id]]);
  assert.ok(!(await call("tabs.query", [{}])).some((tab) => [a.id, b.id, c.id].includes(tab.id)));
  console.log(
    "Real Chromium extension → native host → MCP passed: events, page read/wait/input/click/hover/drag/upload/select/scroll/evaluate/screenshot, groups, windows, tabs, bookmarks, cookies and batch failure behavior.",
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
  // Browser helper processes can outlive the main process for a moment.
  await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
