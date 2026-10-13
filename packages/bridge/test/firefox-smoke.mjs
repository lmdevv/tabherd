// Opt-in integration test: the Firefox build as a temporary add-on in a disposable profile.
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
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
  throw new Error("This opt-in Firefox smoke runner currently supports Linux.");
const exec = promisify(execFile);
const root = fileURLToPath(new URL("../../../", import.meta.url));
const entry = join(root, "packages/bridge/dist/index.js");
const extension = join(root, "apps/extension/dist/firefox-mv2");
const webExt = join(root, "apps/extension/node_modules/.bin/web-ext");
const base = await mkdtemp(join(tmpdir(), "tabherd-firefox-smoke-"));
// Firefox finds native hosts under $HOME/.mozilla, so a temporary HOME isolates registration.
const env = { ...process.env, HOME: join(base, "home"), TABHERD_STATE_DIR: join(base, "state") };
const fixture = createServer((request, response) => {
  response.setHeader("content-type", "text/html");
  if (request.url?.startsWith("/csp"))
    response.setHeader("content-security-policy", "script-src 'none'");
  response.end(`<!doctype html><title>Tabherd Firefox fixture</title>
    <h1>Firefox page control</h1><label>Name <input id="name"></label><button id="save">Save</button>
    <p id="hover">Hover me</p><p id="result">Waiting</p>
    <script>window.pageValue={answer:42};const nameInput=document.getElementById('name');
    document.getElementById('save').addEventListener('click',()=>{document.getElementById('result').textContent='Saved '+nameInput.value;});
    document.getElementById('hover').addEventListener('mouseover',e=>{e.target.textContent='Hovered';});
    setTimeout(()=>{const late=document.createElement('p');late.id='late';late.textContent='Loaded later';document.body.append(late);},700);</script>`);
});
fixture.listen(0, "127.0.0.1");
await once(fixture, "listening");
const url = `http://127.0.0.1:${fixture.address().port}/`;
let firefox;
let logs = "";
let client;
const cli = async (args) =>
  JSON.parse((await exec(process.execPath, [entry, ...args], { env })).stdout);
try {
  await cli(["setup", "--browser", "firefox"]);
  firefox = spawn(
    webExt,
    [
      "run",
      "--source-dir",
      extension,
      "--no-reload",
      "--no-input",
      ...(process.env.TABHERD_FIREFOX ? ["--firefox", process.env.TABHERD_FIREFOX] : []),
      "--arg=-headless",
      "--start-url",
      "about:blank",
    ],
    { env, stdio: ["ignore", "pipe", "pipe"], detached: true },
  );
  for (const stream of [firefox.stdout, firefox.stderr])
    stream.on("data", (data) => {
      logs = (logs + data).slice(-8000);
    });
  let connections = [];
  for (let attempt = 0; attempt < 300 && !connections.length; attempt++) {
    if (firefox.exitCode !== null) break;
    connections = (await cli(["status"])).connections;
    if (!connections.length) await delay(100);
  }
  assert.equal(connections.length, 1, `Firefox extension failed to connect. ${logs}`);
  assert.equal(connections[0].browser, "firefox");
  const report = await cli(["doctor"]).catch((error) => JSON.parse(error.stdout));
  assert.ok(report.ok, JSON.stringify(report));

  client = new Client({ name: "tabherd-firefox-smoke", version: "1" });
  await client.connect(
    new StdioClientTransport({ command: process.execPath, args: [entry, "mcp"], env }),
  );
  const tool = async (name, input = {}) => {
    const response = await client.callTool({ name, arguments: input });
    assert.ok(!response.isError, JSON.stringify(response));
    return response;
  };
  const toolError = async (name, input) => {
    const response = await client.callTool({ name, arguments: input });
    assert.ok(response.isError, JSON.stringify(response));
    return response.content[0].text;
  };
  const call = async (method, args) =>
    (await tool("browser_call", { method, args })).structuredContent.result;
  const page = async (tabId, action, input = {}) =>
    (await tool("browser_page", { tabId, action, ...input })).structuredContent.result;

  const caps = (await tool("browser_capabilities")).structuredContent.result;
  assert.equal(caps.browser, "firefox");
  assert.ok(caps.pageActions.includes("evaluate"));
  assert.ok(!caps.pageActions.includes("upload"));
  const tab = await call("tabs.create", [{ url, active: true }]);
  await page(tab.id, "wait", { timeoutMs: 10000 });
  await page(tab.id, "wait", { selector: "#late", timeoutMs: 5000 });
  const read = await page(tab.id, "read");
  assert.equal(read.title, "Tabherd Firefox fixture");
  assert.ok(read.elements.some((element) => element.selector === "#name"));
  await page(tab.id, "type", { selector: "#name", text: "Fox" });
  await page(tab.id, "click", { selector: "#save" });
  await page(tab.id, "hover", { selector: "#hover" });
  assert.equal(
    await page(tab.id, "evaluate", { expression: "document.getElementById('result').textContent" }),
    "Saved Fox",
  );
  assert.equal(
    await page(tab.id, "evaluate", { expression: "document.getElementById('hover').textContent" }),
    "Hovered",
  );
  // Evaluation runs in the page, so page-defined globals and promises resolve.
  assert.deepEqual(await page(tab.id, "evaluate", { expression: "window.pageValue" }), {
    answer: 42,
  });
  assert.equal(
    await page(tab.id, "evaluate", { expression: "new Promise(r => setTimeout(() => r(7), 50))" }),
    7,
  );
  assert.match(
    await toolError("browser_page", {
      tabId: tab.id,
      action: "evaluate",
      expression: "throw new Error('boom')",
    }),
    /boom/,
  );
  assert.match(
    await toolError("browser_page", {
      tabId: tab.id,
      action: "drag",
      selector: "#name",
      toX: 1,
      toY: 1,
    }),
    /unavailable in Firefox/,
  );
  const screenshot = await tool("browser_page", { tabId: tab.id, action: "screenshot" });
  assert.equal(screenshot.content[0].type, "image");
  const csp = await call("tabs.create", [{ url: `${url}csp`, active: true }]);
  await page(csp.id, "wait", { timeoutMs: 10000 });
  // A CSP that forbids eval falls back to the isolated context, which still sees the DOM.
  assert.equal(
    await page(csp.id, "evaluate", { expression: "document.title" }),
    "Tabherd Firefox fixture",
  );
  const folder = await call("bookmarks.create", [{ title: "Tabherd Firefox smoke" }]);
  await call("bookmarks.removeTree", [folder.id]);
  await call("tabs.remove", [[tab.id, csp.id]]);
  console.log(
    "Real Firefox extension → native host → MCP passed: doctor, capabilities, wait/read/type/click/hover/evaluate/screenshot, tabs and bookmarks.",
  );
} finally {
  await client?.close();
  if (firefox && firefox.exitCode === null) {
    const exited = once(firefox, "exit");
    // web-ext starts Firefox as a child; signal the whole process group.
    process.kill(-firefox.pid, "SIGTERM");
    const timer = setTimeout(() => process.kill(-firefox.pid, "SIGKILL"), 5000);
    await exited;
    clearTimeout(timer);
  }
  await new Promise((resolve) => fixture.close(resolve));
  // Browser helper processes can outlive the main process for a moment.
  await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
