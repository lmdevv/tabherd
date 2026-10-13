import { z } from "zod";

export const HOST_NAME = "com.tabherd.bridge";
export const FIREFOX_ID = "tabherd@local";
// Public half of the key that pins the Chromium extension ID for unpacked installs.
export const CHROMIUM_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAsy4obGtzcbuQNkKr86cpqx4JSvIymSWwzX2E2vzIfiRqu+azMRFMh6tH9PTkmgihTQVaCzV6vdOzDEuMnh6AB5dh1mch1eEmE4UChNlyApLDJdrvB4zaWKTE3/64pDvWSH0trafVS++bHX4oeRtlwnUuLOAW+aBc6q5i00qVQBWRBGifQc7YiLORpB7i1d/IhWdB38dJjxjB3jkaMVhiagPGEjw9HFN2I9ozhvdmdrp2TqlGDf84Hio8a/HD4ve2tiUunVbEeCZ49V0G8jTyLfAQdVzct1Hx8nh8zAulgVlcNia8SUnPCQKRI8j7J9ys+tnynaeRhrFohH21fW3FJQIDAQAB";
export const CHROMIUM_ID = "hepgdbeccdmbongocnnamapillglcbgk";
export const PROTOCOL_VERSION = 1;
export const MAX_MESSAGE_BYTES = 900_000;
// Long waits stay under the 60-second client request timeout.
export const MAX_WAIT_MS = 45_000;
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
      "wait",
      "hover",
      "drag",
      "upload",
    ]),
    selector: z.string().min(1).max(4096).optional(),
    text: z.string().max(100_000).optional(),
    value: z.string().max(100_000).optional(),
    key: z.string().min(1).max(100).optional(),
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
    expression: z.string().min(1).max(100_000).optional(),
    // drag target
    toSelector: z.string().min(1).max(4096).optional(),
    toX: z.number().finite().optional(),
    toY: z.number().finite().optional(),
    // upload: absolute local paths; the CLI resolves relative paths
    files: z.array(z.string().min(1).max(4096)).min(1).max(100).optional(),
    // wait: for selector/text to appear (or disappear with gone), else for the tab to load;
    // url requires the tab URL to contain it, which avoids matching the page before a navigation
    gone: z.boolean().optional(),
    url: z.string().min(1).max(4096).optional(),
    timeoutMs: z.number().int().min(0).max(MAX_WAIT_MS).default(10_000),
    maxTextLength: z.number().int().min(1).max(100_000).default(20_000),
    maxElements: z.number().int().min(1).max(1000).default(200),
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
