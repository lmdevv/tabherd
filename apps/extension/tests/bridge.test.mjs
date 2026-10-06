import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { createEngine } from "../lib/engine.ts";
import { createPageController, domAction } from "../lib/page.ts";
import { createBridge, RETRY_ALARM } from "../lib/bridge.ts";
import { PageRequest, HOST_NAME, MAX_MESSAGE_BYTES } from "@tabherd/protocol";

const page = (input) => PageRequest.parse({ tabId: 12, ...input });

test("page read verifies current form values and checked state without exposing passwords or files", () => {
  class Element {
    constructor(id, tag, type) {
      this.id = id;
      this.localName = tag;
      this.type = type;
    }
    getAttribute(name) {
      return name === "type" ? this.type : null;
    }
  }
  class Input extends Element {
    constructor(id, type, value, checked = false) {
      super(id, "input", type);
      this.value = value;
      this.checked = checked;
    }
  }
  class Textarea extends Element {
    constructor(id, value) {
      super(id, "textarea");
      this.value = value;
    }
  }
  const text = new Input("name", "text", "before");
  const textarea = new Textarea("notes", "current notes");
  const checkbox = new Input("enabled", "checkbox", "on", true);
  const radio = new Input("choice", "radio", "yes", false);
  const password = new Input("password", "password", "secret");
  const file = new Input("upload", "file", "/private/file.txt");
  // Accessing these values would fail the test, even if later omitted from JSON.
  for (const element of [password, file])
    Object.defineProperty(element, "value", {
      get() {
        throw new Error("Sensitive value was read");
      },
    });
  const elements = [text, textarea, checkbox, radio, password, file];
  const context = {
    input: page({ action: "read" }),
    HTMLInputElement: Input,
    HTMLTextAreaElement: Textarea,
    HTMLSelectElement: class {},
    CSS: { escape: (value) => value },
    location: { href: "https://example.test/form" },
    document: {
      title: "Form",
      body: { innerText: "Settings" },
      querySelectorAll(selector) {
        if (selector === "a[href]") return [];
        if (selector.startsWith("#"))
          return elements.filter((element) => `#${element.id}` === selector);
        return elements;
      },
    },
  };
  const read = () => runInNewContext(`(${domAction.toString()})(input)`, context).elements;
  let result = read();
  assert.equal(result[0].value, "before");
  assert.equal(result[1].value, "current notes");
  assert.equal(result[2].checked, true);
  assert.equal(result[3].checked, false);
  assert.equal("value" in result[4], false);
  assert.equal("value" in result[5], false);
  text.value = "after";
  checkbox.checked = false;
  result = read();
  assert.equal(result[0].value, "after");
  assert.equal(result[2].checked, false);
});

test("Chromium shifted keys dispatch uppercase and US punctuation text", async () => {
  const commands = [];
  const controller = createPageController(
    {
      debugger: {
        async attach() {},
        async detach() {},
        async sendCommand(_target, method, params) {
          commands.push({ method, params });
        },
      },
    },
    true,
  );
  for (const key of ["Shift+a", "Shift+1", "Shift+=", "Shift+/", "Control+Shift+a"]) {
    await controller(page({ action: "press", key }));
  }
  const down = commands
    .filter((command) => command.params.type !== "keyUp")
    .map((command) => command.params);
  assert.deepEqual(
    down.map((event) => event.key),
    ["A", "!", "+", "?", "A"],
  );
  assert.deepEqual(
    down.map((event) => event.text),
    ["A", "!", "+", "?", undefined],
  );
  assert.deepEqual(
    down.map((event) => event.modifiers),
    [8, 8, 8, 8, 10],
  );
  assert.deepEqual(
    down.map((event) => event.type),
    ["keyDown", "keyDown", "keyDown", "keyDown", "rawKeyDown"],
  );
});

test("allowlist preserves receiver, rejects unknown methods, and reports actual capabilities", async () => {
  const tabs = {
    marker: "tabs",
    query() {
      assert.equal(this.marker, "tabs");
      return [{ id: 1 }];
    },
  };
  const engine = createEngine({ tabs, runtime: { secret() {} } }, true);
  assert.deepEqual(await engine.dispatch("call", { method: "tabs.query", args: [{}] }), [
    { id: 1 },
  ]);
  await assert.rejects(
    engine.dispatch("call", { method: "runtime.secret" }),
    /Unsupported browser method/,
  );
  // Inherited object properties are not namespaces.
  await assert.rejects(
    engine.dispatch("call", { method: "constructor.name" }),
    /Unsupported browser method/,
  );
  await assert.rejects(
    engine.dispatch("call", { method: "tabs.remove" }),
    /unavailable in this browser/,
  );
  const capabilities = await engine.dispatch("capabilities");
  assert.deepEqual(capabilities.methods, ["tabs.query"]);
  assert.ok(capabilities.pageActions.includes("evaluate"));
});

test("batch preserves order and never executes skipped calls; continueOnError is explicit", async () => {
  const executed = [];
  const engine = createEngine(
    {
      tabs: {
        async remove(id) {
          executed.push(id);
          if (id === 2) throw new Error("missing tab");
        },
      },
    },
    true,
  );
  const calls = [1, 2, 3].map((id) => ({ method: "tabs.remove", args: [id] }));
  let results = await engine.dispatch("batch", { calls });
  assert.deepEqual(executed, [1, 2]);
  assert.deepEqual(
    results.map((result) => result.status),
    ["success", "error", "skipped"],
  );
  assert.deepEqual(
    results.map((result) => result.index),
    [0, 1, 2],
  );
  assert.equal(results[0].result, null);
  executed.length = 0;
  results = await engine.dispatch("batch", { calls, continueOnError: true });
  assert.deepEqual(executed, [1, 2, 3]);
  assert.equal(results[2].status, "success");
});

test("debugger requests on one tab serialize and always detach, including failures", async () => {
  const events = [];
  let sessions = 0;
  const controller = createPageController(
    {
      debugger: {
        async attach() {
          assert.equal(sessions++, 0);
          events.push("attach");
        },
        async detach() {
          sessions--;
          events.push("detach");
        },
        async sendCommand(_target, method, params) {
          events.push(method);
          await new Promise((resolve) => setImmediate(resolve));
          if (params.expression === "fail")
            return { exceptionDetails: { text: "failed evaluation" } };
          return { result: { value: 42 } };
        },
      },
    },
    true,
  );
  const first = controller(page({ action: "evaluate", expression: "fail" }));
  const second = controller(page({ action: "evaluate", expression: "42" }));
  await assert.rejects(first, /failed evaluation/);
  assert.equal(await second, 42);
  assert.deepEqual(events, [
    "attach",
    "Runtime.evaluate",
    "detach",
    "attach",
    "Runtime.evaluate",
    "detach",
  ]);
  assert.equal(sessions, 0);
});

test("Chromium page click uses measured coordinates and trusted input", async () => {
  const commands = [];
  const controller = createPageController(
    {
      scripting: {
        async executeScript(options) {
          assert.equal(options.func, domAction);
          assert.equal(options.args[0].selector, "#submit");
          return [{ frameId: 0, result: { x: 50, y: 25 } }];
        },
      },
      debugger: {
        async attach() {},
        async detach() {},
        async sendCommand(_target, method, params) {
          commands.push({ method, params });
        },
      },
    },
    true,
  );
  assert.deepEqual(await controller(page({ action: "click", selector: "#submit" })), {
    ok: true,
    trusted: true,
  });
  assert.deepEqual(
    commands.map((command) => command.params.type),
    ["mouseMoved", "mousePressed", "mouseReleased"],
  );
  assert.ok(commands.every((command) => command.params.x === 50 && command.params.y === 25));
});

test("Firefox reports script errors and protects visible screenshot semantics", async () => {
  const engine = createEngine({}, false);
  assert.ok(!(await engine.dispatch("capabilities")).pageActions.includes("evaluate"));
  const controller = createPageController(
    {
      tabs: {
        async get() {
          return { active: false, windowId: 2 };
        },
      },
      scripting: {
        async executeScript() {
          return [{ frameId: 4, error: { message: "missing selector" } }];
        },
      },
    },
    false,
  );
  await assert.rejects(
    controller(page({ action: "evaluate", expression: "1" })),
    /requires Chromium/,
  );
  await assert.rejects(controller(page({ action: "screenshot" })), /target tab to be active/);
  await assert.rejects(
    controller(page({ action: "click", selector: "#missing", frameId: 4 })),
    /missing selector/,
  );
});

function nativeMock() {
  let stored = {};
  const alarms = [];
  const ports = [];
  const api = {
    runtime: {
      id: "extension-id",
      connectNative(name) {
        assert.equal(name, HOST_NAME);
        const messages = [];
        let onMessage;
        let onDisconnect;
        const port = {
          messages,
          postMessage(value) {
            messages.push(value);
          },
          onMessage: {
            addListener(listener) {
              onMessage = listener;
            },
          },
          onDisconnect: {
            addListener(listener) {
              onDisconnect = listener;
            },
          },
          disconnect() {
            onDisconnect();
          },
          request(value) {
            onMessage(value);
          },
        };
        ports.push(port);
        return port;
      },
    },
    extension: { inIncognitoContext: false },
    storage: {
      local: {
        async get() {
          return stored;
        },
        async set(value) {
          stored = { ...stored, ...value };
        },
      },
    },
    alarms: {
      async create(name, options) {
        alarms.push({ name, options });
      },
      async clear() {},
    },
    tabs: {
      async query() {
        return [{ id: 1 }];
      },
    },
  };
  return { api, ports, alarms };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("native bridge sends a persistent profile hello, dispatches, and reconnects without replay", async () => {
  const { api, ports, alarms } = nativeMock();
  const bridge = createBridge(api, true);
  await bridge.connect();
  const first = ports[0];
  assert.equal(first.messages[0].type, "hello");
  assert.equal(bridge.getStatus().connected, true);
  first.request({
    type: "request",
    id: "one",
    method: "call",
    input: { method: "tabs.query", args: [{}] },
  });
  await settle();
  assert.deepEqual(first.messages[1], { type: "response", id: "one", result: [{ id: 1 }] });
  first.disconnect();
  assert.equal(bridge.getStatus().connected, false);
  assert.equal(alarms.at(-1).name, RETRY_ALARM);
  await bridge.connect();
  assert.equal(ports[1].messages[0].connectionId, first.messages[0].connectionId);
  assert.equal(ports[1].messages.length, 1);
});

test("wire validation and UTF-8 result bounds return actionable errors", async () => {
  const { api, ports } = nativeMock();
  api.tabs.query = async () => "é".repeat(MAX_MESSAGE_BYTES);
  const bridge = createBridge(api, true);
  await bridge.connect();
  ports[0].request({
    type: "request",
    id: "huge",
    method: "call",
    input: { method: "tabs.query" },
  });
  ports[0].request({ type: "request", id: "bad", method: "unknown" });
  await settle();
  const messages = ports[0].messages;
  assert.match(
    messages.find((message) => message.id === "huge").error,
    /exceeds the native message limit/,
  );
  assert.match(messages.find((message) => message.id === "bad").error, /Invalid bridge request/);
});

test("a disconnected mutation is not replayed on the new connection", async () => {
  const { api, ports } = nativeMock();
  let release;
  let performed = 0;
  api.tabs.remove = async () => {
    performed++;
    await new Promise((resolve) => {
      release = resolve;
    });
  };
  const bridge = createBridge(api, true);
  await bridge.connect();
  ports[0].request({
    type: "request",
    id: "mutation",
    method: "call",
    input: { method: "tabs.remove", args: [1] },
  });
  await settle();
  await bridge.reconnect();
  release();
  await settle();
  assert.equal(performed, 1);
  assert.equal(ports[1].messages.length, 1);
});
