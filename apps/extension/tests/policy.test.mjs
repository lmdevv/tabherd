import assert from "node:assert/strict";
import { test } from "node:test";
import { API_METHODS } from "@tabherd/protocol";
import { createEngine } from "../lib/engine.ts";
import { ACCESS_STORAGE_KEY, allowsMethod, allowsPageAction } from "../lib/policy.ts";

const all = Object.entries(API_METHODS).flatMap(([namespace, methods]) =>
  methods.map((method) => `${namespace}.${method}`),
);

test("access modes classify every allowlisted method", () => {
  assert.ok(all.every((method) => allowsMethod("full", method)));
  const standardBlocked = all.filter((method) => !allowsMethod("standard", method));
  assert.ok(standardBlocked.includes("cookies.getAll"));
  assert.ok(standardBlocked.includes("browsingData.removeHistory"));
  assert.ok(standardBlocked.includes("history.deleteAll"));
  assert.ok(standardBlocked.includes("downloads.removeFile"));
  assert.ok(!standardBlocked.includes("browsingData.settings"));
  assert.ok(!standardBlocked.includes("tabs.remove"), "ordinary tab management stays allowed");
  const readOnly = all.filter((method) => allowsMethod("read-only", method));
  assert.ok(readOnly.includes("tabs.query") && readOnly.includes("bookmarks.search"));
  for (const mutation of [
    "tabs.create",
    "tabs.remove",
    "bookmarks.create",
    "windows.update",
    "search.query",
  ])
    assert.ok(!readOnly.includes(mutation), mutation);
  assert.ok(!readOnly.some((method) => method.startsWith("cookies.")));
  assert.deepEqual(
    ["read", "wait", "screenshot", "click", "type", "evaluate", "upload"].filter((action) =>
      allowsPageAction("read-only", action),
    ),
    ["read", "wait", "screenshot"],
  );
});

function storageApi(initial) {
  let stored = { ...initial };
  const listeners = [];
  return {
    storage: {
      local: {
        async get() {
          return stored;
        },
        async set(value) {
          const changes = Object.fromEntries(
            Object.entries(value).map(([key, newValue]) => [key, { newValue }]),
          );
          stored = { ...stored, ...value };
          for (const listener of listeners) listener(changes, "local");
        },
      },
      onChanged: { addListener: (listener) => listeners.push(listener) },
    },
  };
}

test("the engine enforces the stored mode, follows changes, and records activity", async () => {
  let removed = 0;
  const api = {
    ...storageApi({ [ACCESS_STORAGE_KEY]: "read-only" }),
    tabs: {
      async query() {
        return [{ id: 1 }];
      },
      async remove() {
        removed++;
      },
    },
    cookies: {
      async getAll() {
        return [{ name: "session" }];
      },
    },
  };
  const engine = createEngine(api, true);
  const caps = await engine.dispatch("capabilities");
  assert.equal(caps.access, "read-only");
  assert.deepEqual(caps.methods, ["tabs.query"]);
  assert.deepEqual(caps.pageActions, ["read", "wait", "screenshot"]);
  assert.match(caps.limitations[0], /Read only/);
  await assert.rejects(
    engine.dispatch("call", { method: "tabs.remove", args: [1] }),
    /tabs.remove is blocked: the user set Tabherd to Read only/,
  );
  await assert.rejects(
    engine.dispatch("page", { tabId: 1, action: "click", selector: "#a" }),
    /page click is blocked/,
  );
  const batch = await engine.dispatch("batch", {
    calls: [
      { method: "tabs.query", args: [{}] },
      { method: "tabs.remove", args: [1] },
    ],
  });
  assert.deepEqual(
    batch.map((item) => item.status),
    ["success", "error"],
  );
  assert.equal(removed, 0);
  await api.storage.local.set({ [ACCESS_STORAGE_KEY]: "standard" });
  await engine.dispatch("call", { method: "tabs.remove", args: [1] });
  assert.equal(removed, 1);
  await assert.rejects(
    engine.dispatch("call", { method: "cookies.getAll", args: [{}] }),
    /Standard/,
  );
  await api.storage.local.set({ [ACCESS_STORAGE_KEY]: "full" });
  assert.equal(
    (await engine.dispatch("call", { method: "cookies.getAll", args: [{}] }))[0].name,
    "session",
  );
  const activity = engine.activity();
  assert.equal(activity[0].operation, "cookies.getAll");
  assert.ok(activity[0].ok);
  const failedClick = activity.find((item) => item.operation.startsWith("page click"));
  assert.equal(failedClick.operation, "page click #a (tab 1)");
  assert.equal(failedClick.ok, false);
  assert.match(failedClick.error, /blocked/);
  assert.ok(!JSON.stringify(activity).includes("session"), "results are not recorded");
});

test("an unset or invalid stored mode means full access", async () => {
  for (const value of [undefined, "everything"]) {
    const engine = createEngine(storageApi({ [ACCESS_STORAGE_KEY]: value }), false);
    assert.equal((await engine.dispatch("capabilities")).access, "full");
  }
  assert.equal((await createEngine({}, false).dispatch("capabilities")).access, "full");
});
