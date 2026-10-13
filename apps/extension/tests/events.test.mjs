import assert from "node:assert/strict";
import { test } from "node:test";
import { EventsRequest } from "@tabherd/protocol";
import { createEventLog } from "../lib/events.ts";
import { createEngine } from "../lib/engine.ts";

function mockApi() {
  const listeners = {};
  const event = (name) => ({
    addListener(listener) {
      listeners[name] = listener;
    },
  });
  const namespace = (name, events) =>
    Object.fromEntries(events.map((e) => [e, event(`${name}.${e}`)]));
  return {
    listeners,
    api: {
      tabs: namespace("tabs", [
        "onCreated",
        "onUpdated",
        "onRemoved",
        "onActivated",
        "onMoved",
        "onAttached",
      ]),
      windows: namespace("windows", ["onCreated", "onRemoved", "onFocusChanged"]),
      bookmarks: namespace("bookmarks", ["onCreated", "onChanged", "onMoved", "onRemoved"]),
      downloads: namespace("downloads", ["onCreated", "onChanged"]),
      // No tabGroups: absent APIs are skipped.
    },
  };
}
const query = (input = {}) => EventsRequest.parse(input);

test("events summarize browser changes and cursors return only newer events", async () => {
  const { api, listeners } = mockApi();
  const log = createEventLog(api);
  listeners["tabs.onCreated"]({
    id: 1,
    windowId: 2,
    url: "https://a.test",
    title: "A",
    extra: "x",
  });
  listeners["tabs.onUpdated"](1, { favIconUrl: "icon" }, { id: 1 });
  listeners["tabs.onUpdated"](
    1,
    { status: "complete", favIconUrl: "icon" },
    { id: 1, status: "complete" },
  );
  const first = await log.read(query());
  assert.deepEqual(
    first.events.map((e) => e.type),
    ["tab.created", "tab.updated"],
    "favicon-only updates are ignored",
  );
  assert.equal(first.events[0].tab.extra, undefined);
  assert.deepEqual(first.events[1].changes, { status: "complete" });
  assert.deepEqual(await log.read(query({ cursor: first.cursor })), {
    cursor: first.cursor,
    events: [],
    more: false,
  });
  listeners["tabs.onRemoved"](1, { windowId: 2, isWindowClosing: false });
  listeners["downloads.onChanged"]({
    id: 9,
    state: { previous: "in_progress", current: "complete" },
  });
  const next = await log.read(query({ cursor: first.cursor }));
  assert.deepEqual(
    next.events.map((e) => [e.type, e.tabId ?? e.id]),
    [
      ["tab.removed", 1],
      ["download.changed", 9],
    ],
  );
  assert.deepEqual(next.events[1].changes, { state: "complete" });
  assert.deepEqual(
    (await log.read(query({ cursor: first.cursor, types: ["download."] }))).events.map(
      (e) => e.type,
    ),
    ["download.changed"],
  );
});

test("limits page through events, and eviction or a restart is reported", async () => {
  const { api, listeners } = mockApi();
  const log = createEventLog(api, 3);
  const start = (await log.read(query())).cursor;
  for (let id = 1; id <= 5; id++) listeners["windows.onCreated"]({ id, type: "normal" });
  const evicted = await log.read(query({ cursor: start, limit: 2 }));
  assert.equal(evicted.dropped, true);
  assert.equal(evicted.more, true);
  assert.deepEqual(
    evicted.events.map((e) => e.windowId),
    [3, 4],
  );
  const rest = await log.read(query({ cursor: evicted.cursor }));
  assert.deepEqual(
    rest.events.map((e) => e.windowId),
    [5],
  );
  assert.equal(rest.more, false);
  assert.equal(rest.dropped, undefined);
  const restarted = await log.read(query({ cursor: "oldepoch:2" }));
  assert.equal(restarted.reset, true);
  assert.deepEqual(
    restarted.events.map((e) => e.windowId),
    [3, 4, 5],
  );
  await assert.rejects(
    log.read(query({ cursor: `${start.split(":")[0]}:99` })),
    /Invalid events cursor/,
  );
  // A long poll that waits past an eviction still reports it.
  const waiting = log.read(query({ cursor: start, types: ["tab."], timeoutMs: 2000 }));
  setTimeout(() => listeners["tabs.onActivated"]({ tabId: 1, windowId: 1 }), 10);
  const late = await waiting;
  assert.deepEqual(
    late.events.map((e) => e.type),
    ["tab.activated"],
  );
  assert.equal(late.dropped, true);
});

test("long polling wakes on the first matching event and times out empty", async () => {
  const { api, listeners } = mockApi();
  const log = createEventLog(api);
  const { cursor } = await log.read(query());
  const started = Date.now();
  const waiting = log.read(query({ cursor, types: ["tab.updated"], timeoutMs: 5000 }));
  setTimeout(() => listeners["tabs.onActivated"]({ tabId: 1, windowId: 1 }), 10);
  setTimeout(() => listeners["tabs.onUpdated"](1, { status: "complete" }, { id: 1 }), 30);
  const result = await waiting;
  assert.deepEqual(
    result.events.map((e) => e.type),
    ["tab.updated"],
  );
  assert.ok(Date.now() - started < 2000);
  const empty = await log.read(query({ cursor: result.cursor, timeoutMs: 50 }));
  assert.deepEqual(empty.events, []);
  assert.equal(empty.cursor, result.cursor);
  // A fresh caller with no history waits for the next event.
  const fresh = createEventLog(mockApi().api);
  assert.deepEqual((await fresh.read(query({ timeoutMs: 20 }))).events, []);
});

test("the engine serves events and validates input", async () => {
  const { api, listeners } = mockApi();
  const engine = createEngine(api, true);
  listeners["bookmarks.onCreated"]("7", { parentId: "1", title: "Saved", url: "https://b.test" });
  const result = await engine.dispatch("events", {});
  assert.deepEqual(result.events[0].title, "Saved");
  await assert.rejects(engine.dispatch("events", { timeoutMs: 999999 }));
});
