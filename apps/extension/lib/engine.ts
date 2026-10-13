import {
  API_METHODS,
  BatchRequest,
  CallRequest,
  EventsRequest,
  PageRequest,
  errorMessage,
} from "@tabherd/protocol";
import { createPageController } from "./page.ts";
import { createEventLog } from "./events.ts";
import {
  ACCESS_LABELS,
  ACCESS_STORAGE_KEY,
  allowsMethod,
  allowsPageAction,
  blockedError,
  isAccessMode,
  type AccessMode,
} from "./policy.ts";

// Dynamic namespaces differ by browser. The allowlist is the public boundary.
export type BrowserApi = Record<string, any>;
export interface Activity {
  time: number;
  operation: string;
  ok: boolean;
  error?: string;
}
const ACTIVITY_LIMIT = 50;

export function createEngine(api: BrowserApi, chromium: boolean) {
  const page = createPageController(api, chromium);
  // Listeners must register synchronously at worker start to catch the waking event.
  const events = createEventLog(api);
  let access: AccessMode = "full";
  const loaded: Promise<void> = Promise.resolve(api.storage?.local.get(ACCESS_STORAGE_KEY))
    .then((stored) => {
      if (isAccessMode(stored?.[ACCESS_STORAGE_KEY])) access = stored[ACCESS_STORAGE_KEY];
    })
    .catch(() => {});
  api.storage?.onChanged?.addListener((changes: any, area: string) => {
    const next = changes[ACCESS_STORAGE_KEY]?.newValue;
    // A removed setting means the default.
    if (area === "local" && ACCESS_STORAGE_KEY in changes)
      access = isAccessMode(next) ? next : "full";
  });
  // What the agent did, for the popup. Never includes typed text or results.
  const activity: Activity[] = [];
  const record = (operation: string, error?: unknown) => {
    activity.push({
      time: Date.now(),
      operation,
      ok: error === undefined,
      ...(error === undefined ? {} : { error: errorMessage(error) }),
    });
    if (activity.length > ACTIVITY_LIMIT) activity.shift();
  };
  const describePage = (input: { action: string; tabId: number; selector?: string }) =>
    `page ${input.action}${input.selector ? ` ${input.selector.slice(0, 80)}` : ""} (tab ${input.tabId})`;
  async function tracked<T>(operation: string, run: () => Promise<T>) {
    try {
      const result = await run();
      record(operation);
      return result;
    } catch (error) {
      record(operation, error);
      throw error;
    }
  }
  const available = () =>
    Object.entries(API_METHODS).flatMap(([namespace, methods]) =>
      methods
        .filter((method) => typeof api[namespace]?.[method] === "function")
        .map((method) => `${namespace}.${method}`),
    );

  async function call(input: unknown) {
    const { method, args } = CallRequest.parse(input);
    const [namespace = "", name = ""] = method.split(".");
    if (!Object.hasOwn(API_METHODS, namespace) || !API_METHODS[namespace]!.includes(name)) {
      throw new Error(
        `Unsupported browser method: ${method}. Use browser_capabilities to list available methods.`,
      );
    }
    const receiver = api[namespace];
    if (typeof receiver?.[name] !== "function") {
      throw new Error(
        `${method} is unavailable in this browser. Use browser_capabilities to inspect supported methods.`,
      );
    }
    if (!allowsMethod(access, method)) throw blockedError(access, method);
    return (await receiver[name].apply(receiver, args)) ?? null;
  }

  return {
    activity: () => activity.slice().reverse(),
    access: () => access,
    async dispatch(method: string, input: unknown) {
      await loaded;
      if (method === "capabilities")
        return {
          browser: chromium ? "chrome" : "firefox",
          access,
          methods: available().filter((name) => allowsMethod(access, name)),
          pageActions: [
            "read",
            "wait",
            "click",
            "hover",
            "type",
            "select",
            "scroll",
            "press",
            "evaluate",
            "screenshot",
            ...(chromium ? ["drag", "upload"] : []),
          ].filter((action) => allowsPageAction(access, action)),
          limitations: [
            ...(access === "full"
              ? []
              : [
                  `The user set access to ${ACCESS_LABELS[access]} in the extension popup; methods and page actions it blocks are omitted.`,
                ]),
            "Browser internal pages, extension pages, and other protected pages cannot be scripted.",
            "Page reads return up to maxElements (default 200, max 1000) links and interactive elements; text is bounded by maxTextLength.",
            "wait polls every 200 ms for a visible selector, page text, or (with neither) tab load, up to timeoutMs (max 45000). After a click that navigates, pass url or wait for content from the next page: the old page may still report loaded.",
            ...(chromium
              ? [
                  "Page control attaches the debugger briefly. Close DevTools for the target tab if attachment is refused.",
                  "Trusted input, evaluate, and upload target the main frame; read, wait, select, and scroll accept frameId.",
                  "upload takes absolute local file paths; the CLI and MCP server resolve relative paths.",
                  "Select uses DOM change events; sites requiring trusted selection events may need keyboard input instead.",
                ]
              : [
                  "Firefox uses DOM events for page actions; these events are untrusted and some sites ignore them.",
                  "Firefox evaluate runs in the page. If the page CSP blocks eval, it runs in an isolated context that shares the DOM but not page globals. drag and upload are unavailable.",
                  "Firefox screenshots require the target tab to be visible and active.",
                ]),
            "Large results are rejected; request narrower ranges or smaller page reads.",
            "Events are kept in memory (last 500). A restarted extension worker returns reset: true; dropped: true means older events were evicted.",
          ],
        };
      if (method === "call") {
        const parsed = CallRequest.parse(input);
        return tracked(parsed.method, () => call(parsed));
      }
      if (method === "events") return events.read(EventsRequest.parse(input));
      if (method === "page") {
        const parsed = PageRequest.parse(input);
        return tracked(describePage(parsed), async () => {
          if (!allowsPageAction(access, parsed.action))
            throw blockedError(access, `page ${parsed.action}`);
          return page(parsed);
        });
      }
      if (method === "batch") {
        const { calls, continueOnError } = BatchRequest.parse(input);
        const results = [];
        let stopped = false;
        for (const [index, item] of calls.entries()) {
          if (stopped) {
            results.push({
              index,
              method: item.method,
              status: "skipped",
              error: "Skipped after an earlier call failed.",
            });
            continue;
          }
          try {
            results.push({
              index,
              method: item.method,
              status: "success",
              result: await tracked(item.method, () => call(item)),
            });
          } catch (error) {
            results.push({
              index,
              method: item.method,
              status: "error",
              error: errorMessage(error),
            });
            stopped = !continueOnError;
          }
        }
        return results;
      }
      throw new Error(`Unknown bridge method: ${method}`);
    },
  };
}
