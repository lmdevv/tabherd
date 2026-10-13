import {
  API_METHODS,
  BatchRequest,
  CallRequest,
  PageRequest,
  errorMessage,
} from "@tabherd/protocol";
import { createPageController } from "./page.ts";

// Dynamic namespaces differ by browser. The allowlist is the public boundary.
export type BrowserApi = Record<string, any>;

export function createEngine(api: BrowserApi, chromium: boolean) {
  const page = createPageController(api, chromium);
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
    return (await receiver[name].apply(receiver, args)) ?? null;
  }

  return {
    async dispatch(method: string, input: unknown) {
      if (method === "capabilities")
        return {
          browser: chromium ? "chrome" : "firefox",
          methods: available(),
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
          ],
          limitations: [
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
          ],
        };
      if (method === "call") return call(input);
      if (method === "page") return page(PageRequest.parse(input));
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
              result: await call(item),
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
