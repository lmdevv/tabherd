import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { once } from "node:events";
import { createConnection } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { PROTOCOL_VERSION } from "@tabherd/protocol";
import { connections, dispatch, discover, request } from "../src/client";
import { FrameDecoder, LineDecoder, encodeFrame } from "../src/framing";

const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const exec = promisify(execFile);
type Forwarded = {
  id: string;
  method: string;
  input?: { args?: unknown[]; [key: string]: unknown };
};
function browser(state: string, profile: string) {
  const host = spawn(process.execPath, [entry, "native-host"], {
    env: { ...process.env, TABHERD_STATE_DIR: state },
  });
  const decoder = new FrameDecoder(),
    calls: Forwarded[] = [];
  let stderr = "";
  host.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  host.stdout.on("data", (chunk) => {
    for (const raw of decoder.push(chunk)) {
      const message = raw as Forwarded;
      calls.push(message);
      if (message.input?.args?.[0] === "hang") continue;
      host.stdin.write(
        encodeFrame({
          type: "response",
          id: message.id,
          ...(message.input?.args?.[0] === "error"
            ? { error: "Browser operation rejected" }
            : { result: { method: message.method, input: message.input } }),
        }),
      );
    }
  });
  const hello = encodeFrame({
    type: "hello",
    version: PROTOCOL_VERSION,
    connectionId: profile,
    browser: "chrome",
    extensionId: "a".repeat(32),
    privateContext: false,
  });
  // Exercise the host's actual stdin framing, not just the standalone decoder.
  host.stdin.write(hello.subarray(0, 2));
  host.stdin.write(hello.subarray(2));
  return {
    host,
    calls,
    get stderr() {
      return stderr;
    },
  };
}
async function close(child: ChildProcessWithoutNullStreams) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.stdin.end();
  const timer = setTimeout(() => child.kill(), 1000);
  try {
    await exited;
  } finally {
    clearTimeout(timer);
  }
}
function rpc(child: ChildProcessWithoutNullStreams) {
  const decoder = new LineDecoder(),
    pending = new Map<number, (message: any) => void>();
  let next = 0;
  child.stdout.on("data", (chunk) => {
    for (const raw of decoder.push(chunk)) {
      const message = raw as { id?: number };
      if (typeof message.id === "number") {
        pending.get(message.id)?.(message);
        pending.delete(message.id);
      }
    }
  });
  return {
    async call(method: string, params: unknown = {}): Promise<any> {
      const id = ++next;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`MCP timeout: ${method}`));
        }, 5000);
        pending.set(id, (message) => {
          clearTimeout(timer);
          resolve(message);
        });
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      });
    },
    notify(method: string) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
    },
  };
}
async function ipc(socket: string, payload: string): Promise<{ error?: string }> {
  return new Promise((resolve, reject) => {
    const client = createConnection(socket),
      decoder = new LineDecoder();
    const timer = setTimeout(() => {
      client.destroy();
      reject(new Error("IPC response timeout"));
    }, 2000);
    client.on("connect", () => client.write(payload));
    client.on("data", (chunk) => {
      const responses = decoder.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      if (responses.length) {
        clearTimeout(timer);
        client.destroy();
        resolve(responses[0] as { error?: string });
      }
    });
    client.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

test(
  "authenticated native messaging transports CLI and MCP operations without retrying mutations",
  { timeout: 30000 },
  async () => {
    const state = await mkdtemp(join(tmpdir(), "tabherd-integration-")),
      previous = process.env.TABHERD_STATE_DIR;
    process.env.TABHERD_STATE_DIR = state;
    const a = browser(state, "profile-a"),
      b = browser(state, "profile-b");
    let mcp: ChildProcessWithoutNullStreams | undefined;
    const cli = (args: string[]) =>
      exec(process.execPath, [entry, ...args], {
        env: { ...process.env, TABHERD_STATE_DIR: state },
      });
    try {
      let live = await discover();
      for (let attempt = 0; live.length < 2 && attempt < 100; attempt++) {
        await delay(30);
        live = await discover();
      }
      assert.equal(live.length, 2, `native-host startup: ${a.stderr} ${b.stderr}`);
      const target = live.find((c) => c.connectionId === "profile-a")!;
      if (process.platform !== "win32") {
        assert.equal((await stat(state)).mode & 0o777, 0o700);
        assert.equal((await stat(join(state, "connections"))).mode & 0o777, 0o700);
        assert.equal(
          (await stat(join(state, "connections", `${target.instanceId}.json`))).mode & 0o777,
          0o600,
        );
      }
      await writeFile(join(state, "connections", "malformed.json"), "not json");
      await writeFile(
        join(state, "connections", "stale.json"),
        JSON.stringify({ ...target, socket: join(state, "gone.sock") }),
      );
      assert.equal((await discover()).length, 2);
      assert.equal(
        await readFile(join(state, "connections", "malformed.json"), "utf8"),
        "not json",
      );
      const safe = await connections();
      assert.equal(safe.length, 2);
      assert.ok(!JSON.stringify(safe).includes(target.token));
      assert.ok(!JSON.stringify(safe).includes(target.socket));
      await assert.rejects(
        dispatch("call", { method: "tabs.query", args: [{}] }),
        /Multiple browser profiles/,
      );
      await assert.rejects(
        dispatch("call", { method: "tabs.query", connectionId: "missing" }),
        /No matching browser/,
      );
      await assert.rejects(
        dispatch("call", { method: "tabs.query", args: {}, connectionId: "profile-a" }),
      );
      assert.equal(a.calls.length, 0);
      assert.deepEqual(
        await dispatch("call", { method: "tabs.query", args: [{}], connectionId: "profile-a" }),
        { method: "call", input: { method: "tabs.query", args: [{}], connectionId: "profile-a" } },
      );
      assert.equal(b.calls.length, 0);
      await assert.rejects(request({ ...target, token: "bad-token" }, "call", {}), /Unauthorized/);
      await assert.rejects(
        request({ ...target, token: target.token.replace(/.$/, "") }, "call", {}),
        /Unauthorized/,
      );
      assert.ok((await ipc(target.socket, "invalid-json\n")).error);
      assert.ok(
        (
          await ipc(
            target.socket,
            JSON.stringify({ token: target.token, method: "unsupported" }) + "\n",
          )
        ).error,
      );
      assert.ok(
        (
          await ipc(
            target.socket,
            JSON.stringify({ token: target.token, method: "call", unexpected: true }) + "\n",
          )
        ).error,
      );
      assert.equal(a.calls.length, 1);
      await assert.rejects(
        request(target, "call", { args: ["error"] }),
        /Browser operation rejected/,
      );
      await assert.rejects(
        request(target, "call", { args: ["hang"] }, 40),
        /outcome may be unknown/,
      );
      await delay(80);
      assert.equal(a.calls.filter((c) => c.input?.args?.[0] === "hang").length, 1);
      const timedOut = a.calls.find((c) => c.input?.args?.[0] === "hang")!;
      a.host.stdin.write(
        encodeFrame({ type: "response", id: timedOut.id, result: "late response" }),
      );
      assert.deepEqual(await request(target, "capabilities", {}), {
        method: "capabilities",
        input: {},
      });
      const status = JSON.parse((await cli(["status"])).stdout);
      assert.ok(JSON.stringify(status).includes("profile-b"));
      assert.ok(!JSON.stringify(status).includes(target.token));
      const called = JSON.parse(
        (await cli(["call", "tabs.query", '[{"currentWindow":true}]', "--connection", "profile-b"]))
          .stdout,
      );
      assert.deepEqual(called, {
        method: "call",
        input: { method: "tabs.query", args: [{ currentWindow: true }], connectionId: "profile-b" },
      });
      const batched = JSON.parse(
        (
          await cli([
            "batch",
            '[{"method":"tabs.remove","args":[[7,8]]}]',
            "--continue-on-error",
            "--connection",
            "profile-b",
          ])
        ).stdout,
      );
      assert.deepEqual(batched.input, {
        calls: [{ method: "tabs.remove", args: [[7, 8]] }],
        continueOnError: true,
        connectionId: "profile-b",
      });
      const page = JSON.parse(
        (
          await cli([
            "page",
            "17",
            '{"action":"read","maxTextLength":1000}',
            "--connection",
            "profile-b",
          ])
        ).stdout,
      );
      assert.deepEqual(page.input, {
        tabId: 17,
        action: "read",
        maxTextLength: 1000,
        connectionId: "profile-b",
      });
      const capabilities = JSON.parse(
        (await cli(["capabilities", "--connection", "profile-b"])).stdout,
      );
      assert.deepEqual(capabilities, {
        method: "capabilities",
        input: { connectionId: "profile-b" },
      });
      const before = b.calls.length;
      await assert.rejects(cli(["call", "tabs.query", "bad-json", "--connection", "profile-b"]));
      await assert.rejects(
        cli(["page", "invalid", '{"action":"read"}', "--connection", "profile-b"]),
      );
      await assert.rejects(cli(["call", "tabs.query", "{}", "--connection", "profile-b"]));
      assert.equal(b.calls.length, before);

      mcp = spawn(process.execPath, [entry, "mcp"], {
        env: { ...process.env, TABHERD_STATE_DIR: state },
      });
      const client = rpc(mcp);
      const initialized = await client.call("initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      });
      assert.ok(initialized.result?.serverInfo);
      assert.ok(initialized.result?.capabilities.tools);
      client.notify("notifications/initialized");
      const listed = await client.call("tools/list");
      assert.deepEqual(listed.result.tools.map((t: any) => t.name).sort(), [
        "browser_batch",
        "browser_call",
        "browser_capabilities",
        "browser_connections",
        "browser_page",
      ]);
      assert.ok(listed.result.tools.every((t: any) => t.inputSchema.type === "object"));
      const connected = await client.call("tools/call", {
        name: "browser_connections",
        arguments: {},
      });
      assert.equal(connected.result.structuredContent.result.length, 2);
      assert.ok(!JSON.stringify(connected).includes(target.token));
      for (const [name, args, method] of [
        [
          "browser_call",
          {
            method: "bookmarks.create",
            args: [{ title: "Docs", url: "https://example.com" }],
            connectionId: "profile-a",
          },
          "call",
        ],
        [
          "browser_batch",
          {
            calls: [{ method: "tabs.group", args: [{ tabIds: [1, 2] }] }],
            connectionId: "profile-a",
          },
          "batch",
        ],
        [
          "browser_page",
          { tabId: 9, action: "click", selector: "#submit", connectionId: "profile-a" },
          "page",
        ],
        ["browser_capabilities", { connectionId: "profile-a" }, "capabilities"],
      ] as const) {
        const result = await client.call("tools/call", { name, arguments: args });
        assert.equal(result.result.isError, undefined, JSON.stringify(result));
        assert.equal(result.result.structuredContent.result.method, method);
        assert.equal(result.result.structuredContent.result.input.connectionId, "profile-a");
      }
      const ambiguous = await client.call("tools/call", {
        name: "browser_call",
        arguments: { method: "tabs.query" },
      });
      assert.equal(ambiguous.result.isError, true);
      for (const [name, args] of [
        ["browser_call", { method: "tabs.query", args: {} }],
        ["browser_batch", { calls: [] }],
        ["browser_page", { tabId: -1, action: "read" }],
        ["browser_page", { tabId: 1, action: "unsupported" }],
      ]) {
        const before: number = a.calls.length + b.calls.length;
        const result = await client.call("tools/call", { name, arguments: args });
        assert.ok(result.error || result.result?.isError, JSON.stringify(result));
        assert.equal(a.calls.length + b.calls.length, before);
      }
      await close(a.host);
      await close(b.host);
      assert.deepEqual(await discover(), []);
      assert.deepEqual((await readdir(join(state, "connections"))).sort(), [
        "malformed.json",
        "stale.json",
      ]);
      const empty = await client.call("tools/call", { name: "browser_connections", arguments: {} });
      assert.deepEqual(empty.result.structuredContent.result, []);
      const unavailable = await client.call("tools/call", {
        name: "browser_capabilities",
        arguments: {},
      });
      assert.equal(unavailable.result.isError, true);
    } finally {
      await Promise.all([close(a.host), close(b.host), ...(mcp ? [close(mcp)] : [])]);
      if (previous === undefined) delete process.env.TABHERD_STATE_DIR;
      else process.env.TABHERD_STATE_DIR = previous;
      await rm(state, { recursive: true, force: true });
    }
  },
);

test(
  "native host rejects malformed browser input and exits with clean registry",
  { timeout: 10000 },
  async () => {
    const state = await mkdtemp(join(tmpdir(), "tabherd-invalid-native-"));
    try {
      const invalidHello = encodeFrame({ type: "hello", version: 999 });
      const validHello = encodeFrame({
        type: "hello",
        version: PROTOCOL_VERSION,
        connectionId: "profile",
        browser: "chrome",
        extensionId: "a".repeat(32),
        privateContext: false,
      });
      for (const frame of [
        invalidHello,
        Buffer.from([0, 0, 0, 0]),
        encodeFrame({ type: "hello" }).subarray(0, 5),
        Buffer.concat([invalidHello, validHello]),
      ]) {
        const host = spawn(process.execPath, [entry, "native-host"], {
          env: { ...process.env, TABHERD_STATE_DIR: state },
        });
        let output = "";
        host.stderr.on("data", (chunk) => {
          output += chunk;
        });
        const exited = once(host, "exit");
        host.stdin.end(frame);
        await exited;
        assert.ok(output.length > 0, "malformed message should produce a diagnostic on stderr");
        assert.deepEqual(await readdir(join(state, "connections")), []);
      }
    } finally {
      await rm(state, { recursive: true, force: true });
    }
  },
);
