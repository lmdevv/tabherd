import type { EventsInput } from "@tabherd/protocol";
import type { BrowserApi } from "./engine.ts";

export interface BrowserEvent {
  seq: number;
  time: number;
  type: string;
  [key: string]: unknown;
}
const tabSummary = (tab: any) =>
  tab && {
    id: tab.id,
    windowId: tab.windowId,
    index: tab.index,
    url: tab.url,
    title: tab.title,
    status: tab.status,
    active: tab.active,
    pinned: tab.pinned,
    groupId: tab.groupId,
  };
// Changes worth waking an agent for; favicon and similar churn are left out.
const TAB_CHANGES = ["status", "url", "title", "pinned", "groupId", "audible", "discarded"];

// A bounded in-memory log of browser events. The epoch changes when the worker restarts,
// so a cursor from before the restart is detected instead of silently skipping events.
export function createEventLog(api: BrowserApi, capacity = 500) {
  const epoch = crypto.randomUUID().slice(0, 8);
  const buffer: BrowserEvent[] = [];
  const waiters = new Set<() => void>();
  let seq = 0;
  function push(type: string, data: Record<string, unknown>) {
    // Data never overrides the event's own fields.
    buffer.push({ ...data, seq: ++seq, time: Date.now(), type });
    if (buffer.length > capacity) buffer.shift();
    for (const wake of waiters) wake();
  }
  const listen = (namespace: string, event: string, handler: (...args: any[]) => void) =>
    api[namespace]?.[event]?.addListener?.(handler);

  listen("tabs", "onCreated", (tab) => push("tab.created", { tab: tabSummary(tab) }));
  listen("tabs", "onUpdated", (tabId, changes, tab) => {
    const relevant = Object.fromEntries(
      Object.entries(changes ?? {}).filter(([key]) => TAB_CHANGES.includes(key)),
    );
    if (Object.keys(relevant).length)
      push("tab.updated", { tabId, changes: relevant, tab: tabSummary(tab) });
  });
  listen("tabs", "onRemoved", (tabId, info) =>
    push("tab.removed", { tabId, windowId: info?.windowId, windowClosing: info?.isWindowClosing }),
  );
  listen("tabs", "onActivated", (info) =>
    push("tab.activated", { tabId: info.tabId, windowId: info.windowId }),
  );
  listen("tabs", "onMoved", (tabId, info) => push("tab.moved", { tabId, ...info }));
  listen("tabs", "onAttached", (tabId, info) =>
    push("tab.attached", { tabId, windowId: info.newWindowId, index: info.newPosition }),
  );
  listen("windows", "onCreated", (window) =>
    push("window.created", {
      windowId: window.id,
      windowType: window.type,
      incognito: window.incognito,
    }),
  );
  listen("windows", "onRemoved", (windowId) => push("window.removed", { windowId }));
  listen("windows", "onFocusChanged", (windowId) => push("window.focused", { windowId }));
  for (const [event, type] of [
    ["onCreated", "group.created"],
    ["onUpdated", "group.updated"],
    ["onRemoved", "group.removed"],
  ])
    listen("tabGroups", event!, (group) => push(type!, { group }));
  listen("bookmarks", "onCreated", (id, bookmark) =>
    push("bookmark.created", {
      id,
      parentId: bookmark.parentId,
      title: bookmark.title,
      url: bookmark.url,
    }),
  );
  listen("bookmarks", "onChanged", (id, changes) => push("bookmark.changed", { id, ...changes }));
  listen("bookmarks", "onMoved", (id, info) =>
    push("bookmark.moved", { id, parentId: info.parentId, index: info.index }),
  );
  listen("bookmarks", "onRemoved", (id, info) =>
    push("bookmark.removed", { id, parentId: info.parentId }),
  );
  listen("downloads", "onCreated", (item) =>
    push("download.created", {
      id: item.id,
      url: item.url,
      filename: item.filename,
      state: item.state,
    }),
  );
  listen("downloads", "onChanged", (delta) => {
    const changes = Object.fromEntries(
      Object.entries(delta)
        .filter(([key]) => key !== "id")
        .map(([key, value]: [string, any]) => [key, value?.current]),
    );
    push("download.changed", { id: delta.id, changes });
  });

  function select(input: EventsInput) {
    const matches = (event: BrowserEvent) =>
      !input.types?.length || input.types.some((prefix) => event.type.startsWith(prefix));
    if (input.cursor === undefined) {
      // No cursor: recent history, and everything up to now counts as seen.
      return {
        cursor: `${epoch}:${seq}`,
        events: buffer.filter(matches).slice(-input.limit),
        more: false,
      };
    }
    const [cursorEpoch, cursorSeq] = input.cursor.split(":");
    // A cursor from before a worker restart: replay what this worker has.
    const reset = cursorEpoch !== epoch;
    const since = reset ? 0 : Number(cursorSeq);
    if (!Number.isInteger(since) || since < 0 || since > seq)
      throw new Error("Invalid events cursor. Omit cursor to start again.");
    const newer = buffer.filter((event) => event.seq > since && matches(event));
    const events = newer.slice(0, input.limit);
    const more = events.length < newer.length;
    return {
      cursor: `${epoch}:${more ? events.at(-1)!.seq : seq}`,
      events,
      more,
      ...(reset ? { reset: true } : {}),
      // The buffer evicted events this cursor had not seen.
      ...(buffer.length && buffer[0]!.seq > since + 1 ? { dropped: true } : {}),
    };
  }
  return {
    push,
    async read(input: EventsInput) {
      const first = select(input);
      if (first.events.length || !input.timeoutMs) return first;
      const next = { ...input, cursor: first.cursor };
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, input.timeoutMs);
        function wake() {
          if (select(next).events.length) done();
        }
        function done() {
          clearTimeout(timer);
          waiters.delete(wake);
          resolve();
        }
        waiters.add(wake);
      });
      // Missed-event flags describe the caller's cursor, so carry them over.
      return {
        ...select(next),
        ...("reset" in first ? { reset: true } : {}),
        ...("dropped" in first ? { dropped: true } : {}),
      };
    },
  };
}
