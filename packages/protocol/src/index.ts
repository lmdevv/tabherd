import { z } from "zod";

export const HOST_NAME = "com.tabby.bridge";
export const FIREFOX_ID = "tabby@local";
export const PROTOCOL_VERSION = 1;
export const MAX_MESSAGE_BYTES = 900_000;
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const connectionId = z.string().min(1).max(200).optional();
export const Call = z
  .object({
    method: z.string().regex(/^[a-zA-Z]+\.[a-zA-Z]+$/),
    args: z.array(z.unknown()).max(20).default([]),
  })
  .strict();
export const CallRequest = Call.extend({ connectionId });
export const BatchRequest = z
  .object({
    connectionId,
    calls: z.array(Call).min(1).max(100),
    continueOnError: z.boolean().default(false),
  })
  .strict();
export const PageRequest = z
  .object({
    connectionId,
    tabId: z.number().int().nonnegative(),
    action: z.enum([
      "read",
      "click",
      "type",
      "select",
      "scroll",
      "press",
      "evaluate",
      "screenshot",
    ]),
    selector: z.string().min(1).max(4096).optional(),
    text: z.string().max(100_000).optional(),
    value: z.string().max(100_000).optional(),
    key: z.string().min(1).max(100).optional(),
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
    expression: z.string().min(1).max(100_000).optional(),
    maxTextLength: z.number().int().min(1).max(100_000).default(20_000),
    frameId: z.number().int().nonnegative().optional(),
  })
  .strict();
export type PageInput = z.infer<typeof PageRequest>;
export const Hello = z
  .object({
    type: z.literal("hello"),
    version: z.literal(PROTOCOL_VERSION),
    connectionId: z.string().min(1).max(200),
    browser: z.enum(["chrome", "firefox"]),
    extensionId: z.string().min(1),
    privateContext: z.boolean(),
  })
  .strict();
export type HelloInput = z.infer<typeof Hello>;
export const WireRequest = z
  .object({
    type: z.literal("request"),
    id: z.string().min(1),
    method: z.enum(["call", "batch", "page", "capabilities"]),
    input: z.unknown().optional(),
  })
  .strict();
export const WireResponse = z
  .object({
    type: z.literal("response"),
    id: z.string().min(1),
    result: z.unknown().optional(),
    error: z.string().optional(),
  })
  .strict();
export type BridgeMethod = z.infer<typeof WireRequest>["method"];

// JSON-friendly, one-shot extension methods. Events and function-bearing APIs need adapters.
export const API_METHODS: Record<string, readonly string[]> = {
  tabs: [
    "query",
    "get",
    "getCurrent",
    "create",
    "update",
    "remove",
    "move",
    "duplicate",
    "reload",
    "discard",
    "group",
    "ungroup",
    "highlight",
    "goBack",
    "goForward",
    "getZoom",
    "setZoom",
    "getZoomSettings",
    "setZoomSettings",
    "captureVisibleTab",
    "detectLanguage",
  ],
  windows: ["get", "getCurrent", "getLastFocused", "getAll", "create", "update", "remove"],
  tabGroups: ["get", "query", "update", "move"],
  bookmarks: [
    "get",
    "getChildren",
    "getRecent",
    "getTree",
    "getSubTree",
    "search",
    "create",
    "move",
    "update",
    "remove",
    "removeTree",
  ],
  history: ["search", "getVisits", "addUrl", "deleteUrl", "deleteRange", "deleteAll"],
  sessions: ["getRecentlyClosed", "restore", "getDevices"],
  downloads: [
    "download",
    "search",
    "pause",
    "resume",
    "cancel",
    "erase",
    "removeFile",
    "show",
    "getFileIcon",
  ],
  cookies: ["get", "getAll", "getAllCookieStores", "set", "remove"],
  browsingData: [
    "settings",
    "remove",
    "removeCache",
    "removeCacheStorage",
    "removeFileSystems",
    "removeIndexedDB",
    "removeServiceWorkers",
    "removeCookies",
    "removeDownloads",
    "removeFormData",
    "removeHistory",
    "removeLocalStorage",
    "removePasswords",
  ],
  search: ["query", "search"],
};
